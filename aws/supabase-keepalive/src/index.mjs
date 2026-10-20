// Keeps both Supabase projects (dev + prod) from being paused for
// inactivity. Runs on a schedule (see ../template.yaml), connects straight
// to each project's Postgres and upserts the one row in public.keepalive
// (see supabase/migrations/20261020000001_add_keepalive.sql).
//
// It used to make an anon PostgREST read instead, so no secret had to live
// in AWS — but Supabase didn't count that as activity, and dev was paused
// in Oct 2026 despite being pinged every 3 days. A real write over a real
// connection is as close to actual usage as it gets.
//
// The connection strings (passwords included) live in SSM Parameter Store
// as SecureStrings, put there by scripts/deploy-keepalive.js — only the
// parameter names are in the environment. They're the transaction-pooler
// URLs: the direct db.<ref>.supabase.co hosts are IPv6-only, which Lambda
// outside a VPC can't reach.
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import pg from 'pg'

const ssm = new SSMClient({})

const TARGETS = [
  { name: 'dev', param: process.env.DEV_DB_URL_PARAM },
  { name: 'prod', param: process.env.PROD_DB_URL_PARAM },
]

async function ping({ name, param }) {
  if (!param) throw new Error(`${name}: missing SSM parameter name`)

  const { Parameter } = await ssm.send(new GetParameterCommand({ Name: param, WithDecryption: true }))

  // Supabase's pooler presents a cert from Supabase's own root CA, not a
  // public one, so it can't be verified against Node's default bundle.
  // The connection is still encrypted.
  const client = new pg.Client({
    connectionString: Parameter.Value,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    query_timeout: 20_000,
  })

  await client.connect()
  try {
    const { rows } = await client.query(
      `INSERT INTO public.keepalive (id, pinged_at) VALUES (1, now())
       ON CONFLICT (id) DO UPDATE SET pinged_at = excluded.pinged_at
       RETURNING pinged_at`
    )
    return `${name}: wrote ${rows[0].pinged_at.toISOString()}`
  } finally {
    await client.end()
  }
}

// One project being down (or already paused — its hostname stops resolving,
// so connect throws) mustn't stop the other from being pinged, so every
// target is always attempted. Any failure still fails the invocation as a
// whole, so it shows up as a Lambda error (and in the function's Errors
// metric) rather than passing silently — and, once Lambda's retries are
// used up, as an email (see EventInvokeConfig in ../template.yaml).
//
// Invoking with {"simulateFailure": true} fails on purpose without pinging
// anything, to check that the alert email actually arrives.
export async function handler(event) {
  if (event?.simulateFailure) throw new Error('Supabase keep-alive failed — simulated failure (alert test)')

  const results = await Promise.allSettled(TARGETS.map(ping))

  const failures = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(result.value)
    } else {
      const code = result.reason?.code || result.reason?.cause?.code
      const reason = `${TARGETS[i].name}: ${result.reason?.message || String(result.reason)}${code ? ` (${code})` : ''}`
      console.error(reason)
      failures.push(reason)
    }
  })

  if (failures.length > 0) throw new Error(`Supabase keep-alive failed — ${failures.join('; ')}`)
  return { ok: true }
}
