#!/usr/bin/env node
// Deploys the Supabase keep-alive pinger (aws/supabase-keepalive) to AWS:
// a small Lambda on an EventBridge schedule that queries both the dev and
// prod Supabase projects so neither gets paused for inactivity.
//
// Uses whatever AWS credentials/region the `aws`/`sam` CLIs are already
// configured with. The two anon keys come from .env.local:
//   SUPABASE_PROD_ANON_KEY — prod's anon key (required)
//   SUPABASE_DEV_ANON_KEY  — dev's; falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY,
//                            since .env.local normally points the app at dev
// Failure alerts are emailed to KEEPALIVE_ALERT_EMAIL if that's set in
// .env.local, otherwise to this repo's `git config user.email`. AWS emails
// that address a confirmation link on first deploy — click it, or no alert
// is ever delivered.
// Re-running is safe — it updates the existing stack in place.
//
// Usage: node --env-file=.env.local scripts/deploy-keepalive.js
// (invoked via `npm run keepalive:deploy`)
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const STACK_NAME = 'dues-supabase-keepalive'

const devAnonKey = process.env.SUPABASE_DEV_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const prodAnonKey = process.env.SUPABASE_PROD_ANON_KEY

const alertEmail =
  process.env.KEEPALIVE_ALERT_EMAIL ||
  spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout.trim()

const missing = []
if (!devAnonKey) missing.push('SUPABASE_DEV_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)')
if (!prodAnonKey) missing.push('SUPABASE_PROD_ANON_KEY')
if (!alertEmail) {
  console.error('No alert address: set KEEPALIVE_ALERT_EMAIL in .env.local (or `git config user.email`).')
  process.exit(1)
}
if (missing.length > 0) {
  console.error(
    `Missing in .env.local: ${missing.join(', ')} — copy each from that project's ` +
    'Dashboard > Settings > API > anon / public key. See .env.example.'
  )
  process.exit(1)
}

const deploy = spawnSync(
  'sam',
  [
    'deploy',
    '--template-file', path.join(__dirname, '..', 'aws', 'supabase-keepalive', 'template.yaml'),
    '--stack-name', STACK_NAME,
    '--resolve-s3',
    '--capabilities', 'CAPABILITY_IAM',
    '--no-confirm-changeset',
    '--no-fail-on-empty-changeset',
    '--parameter-overrides',
    `DevSupabaseAnonKey=${devAnonKey}`,
    `ProdSupabaseAnonKey=${prodAnonKey}`,
    `AlertEmail=${alertEmail}`,
  ],
  { stdio: 'inherit' }
)
process.exit(deploy.status ?? 1)
