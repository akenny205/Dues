#!/usr/bin/env node
// Pushes supabase/migrations straight to a Postgres connection string
// instead of going through `supabase link` + `db push --linked`. That
// normal path calls Supabase's `cli/login-role` management endpoint to
// provision a short-lived DB role, which is currently rejected on both our
// projects (42501: permission denied to alter role "cli_login_postgres") —
// a platform-side issue, not caused by anything in this repo. `--db-url`
// skips that provisioning step entirely.
//
// One more wrinkle worth the extra code below: `supabase db push`'s own
// interactive confirmation prompt lists *every* local migration file as a
// candidate, regardless of what's actually already applied remotely — only
// `--dry-run` (and the real, non-interactive apply) correctly diff against
// the remote history table. So we ask our own question here, backed by
// --dry-run's real answer, then push with --yes so the CLI's misleading
// prompt never renders.
//
// A prod push also refuses to run ahead of dev: every migration going to
// prod must already be live on dev first (see requireDevCaughtUp below) —
// there's no flag or env var to bypass that, on purpose.
//
// Usage: node --env-file=.env.local scripts/db-push.js <dev|prod>
// (invoked via `npm run db:push:dev` / `npm run db:push:prod`)
const { spawnSync } = require('node:child_process')
const readline = require('node:readline/promises')
const { stdin, stdout } = require('node:process')

function dbUrlFor(target) {
  const envVar = { dev: 'SUPABASE_DEV_DB_URL', prod: 'SUPABASE_PROD_DB_URL' }[target]
  const dbUrl = process.env[envVar]
  if (!dbUrl) {
    console.error(
      `Missing ${envVar} in .env.local — copy the "Direct connection" URI from ` +
      'Project Settings > Database in the Supabase dashboard for that project, ' +
      'percent-encode the password, and set it as this variable. See .env.example.'
    )
    process.exit(1)
  }
  return dbUrl
}

// Runs `--dry-run` against a target and returns the parsed JSON result.
function dryRun(dbUrl) {
  const proc = spawnSync(
    'npx',
    ['supabase', 'db', 'push', '--db-url', dbUrl, '--dry-run', '--output-format', 'json'],
    { encoding: 'utf8' }
  )

  if (proc.status !== 0) {
    stdout.write(proc.stdout)
    process.stderr.write(proc.stderr)
    process.exit(proc.status ?? 1)
  }

  try {
    return JSON.parse(proc.stdout.trim())
  } catch {
    console.error('Could not parse dry-run output:\n' + proc.stdout)
    process.exit(1)
  }
}

// Refuses to push to prod while dev is behind — dev must have every
// migration that's about to go to prod applied first. No override: if you
// need to skip this, push to dev instead.
function requireDevCaughtUp() {
  const devUrl = dbUrlFor('dev')
  const devResult = dryRun(devUrl)
  if (!devResult.upToDate) {
    console.error(`Refusing to push to prod: dev has ${devResult.migrations.length} migration(s) not yet pushed there:`)
    for (const m of devResult.migrations) console.error(`  • ${m}`)
    console.error('\nRun `npm run db:push:dev` first.')
    process.exit(1)
  }
}

async function main() {
  const target = process.argv[2]
  if (target !== 'dev' && target !== 'prod') {
    console.error('Usage: node scripts/db-push.js <dev|prod>')
    process.exit(1)
  }

  if (target === 'prod') {
    requireDevCaughtUp()
  }

  const dbUrl = dbUrlFor(target)
  const result = dryRun(dbUrl)

  if (result.upToDate) {
    console.log(`${target}: already up to date, nothing to push.`)
    process.exit(0)
  }

  console.log(`${target}: ${result.migrations.length} migration(s) pending:`)
  for (const m of result.migrations) console.log(`  • ${m}`)

  const rl = readline.createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(`\nPush these to ${target}? (y/N) `)
  rl.close()

  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Aborted.')
    process.exit(0)
  }

  const push = spawnSync('npx', ['supabase', 'db', 'push', '--db-url', dbUrl, '--yes'], { stdio: 'inherit' })
  process.exit(push.status ?? 1)
}

main()
