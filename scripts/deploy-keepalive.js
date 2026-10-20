#!/usr/bin/env node
// Deploys the Supabase keep-alive pinger (aws/supabase-keepalive) to AWS:
// a small Lambda on an EventBridge schedule that writes a row in both the
// dev and prod Supabase databases so neither gets paused for inactivity.
//
// Uses whatever AWS credentials/region the `aws`/`sam` CLIs are already
// configured with. The two connection strings come from .env.local —
// SUPABASE_DEV_DB_URL / SUPABASE_PROD_DB_URL, the same ones db-push.js uses —
// and are stored as SSM SecureStrings for the Lambda to read at run time,
// so the passwords never pass through CloudFormation or sit in the
// function's environment. They must be the transaction-pooler URLs
// (*.pooler.supabase.com): the direct db.<ref>.supabase.co hosts are
// IPv6-only, and Lambda outside a VPC can't reach them.
//
// Failure alerts are emailed to KEEPALIVE_ALERT_EMAIL if that's set in
// .env.local, otherwise to this repo's `git config user.email`. AWS emails
// that address a confirmation link on first deploy — click it, or no alert
// is ever delivered.
// Re-running is safe — it overwrites the parameters and updates the
// existing stack in place.
//
// Usage: node --env-file=.env.local scripts/deploy-keepalive.js
// (invoked via `npm run keepalive:deploy`)
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const STACK_NAME = 'dues-supabase-keepalive'
const STACK_DIR = path.join(__dirname, '..', 'aws', 'supabase-keepalive')
const PARAMS = {
  dev: { envVar: 'SUPABASE_DEV_DB_URL', name: '/dues-app/keepalive/dev-db-url' },
  prod: { envVar: 'SUPABASE_PROD_DB_URL', name: '/dues-app/keepalive/prod-db-url' },
}

const alertEmail =
  process.env.KEEPALIVE_ALERT_EMAIL ||
  spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout.trim()

if (!alertEmail) {
  console.error('No alert address: set KEEPALIVE_ALERT_EMAIL in .env.local (or `git config user.email`).')
  process.exit(1)
}

const missing = Object.values(PARAMS).filter(p => !process.env[p.envVar]).map(p => p.envVar)
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')} — see .env.example.`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  const proc = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (proc.status !== 0) process.exit(proc.status ?? 1)
}

// Each value goes through a private (0600) temp file via --cli-input-json
// rather than as an argument, so the password never shows up in the
// process list. The file is removed straight after.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keepalive-'))
let putStatus = 0
try {
  for (const [target, { envVar, name }] of Object.entries(PARAMS)) {
    console.log(`Storing ${target} connection string in SSM (${name})…`)
    const inputFile = path.join(tmpDir, `${target}.json`)
    fs.writeFileSync(
      inputFile,
      JSON.stringify({ Name: name, Type: 'SecureString', Overwrite: true, Value: process.env[envVar] }),
      { mode: 0o600 }
    )
    const put = spawnSync('aws', ['ssm', 'put-parameter', '--cli-input-json', `file://${inputFile}`, '--no-cli-pager'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    if (put.status !== 0) {
      putStatus = put.status ?? 1
      break
    }
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
if (putStatus !== 0) process.exit(putStatus)

// `sam build` installs the function's npm dependencies (pg) into
// .aws-sam/build — a plain `sam deploy` of the source template would upload
// src/ without them.
run('sam', ['build', '--template-file', path.join(STACK_DIR, 'template.yaml')], { cwd: STACK_DIR })

run('sam', [
  'deploy',
  '--template-file', path.join(STACK_DIR, '.aws-sam', 'build', 'template.yaml'),
  '--stack-name', STACK_NAME,
  '--resolve-s3',
  '--capabilities', 'CAPABILITY_IAM',
  '--no-confirm-changeset',
  '--no-fail-on-empty-changeset',
  '--parameter-overrides',
  `AlertEmail=${alertEmail}`,
], { cwd: STACK_DIR })
