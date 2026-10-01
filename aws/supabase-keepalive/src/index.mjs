// Keeps both Supabase projects (dev + prod) from being paused for
// inactivity. Runs on a schedule (see ../template.yaml) and makes one real
// query against each project's database through PostgREST — an actual
// SELECT on "Group", not just a hit on the API gateway. As the anon role
// RLS returns no rows, which is fine: the point is that Postgres ran a
// query, not what came back.
//
// Only needs each project's URL and anon key — the same public values the
// browser already ships with — so nothing secret lives in this function.
// (That's why it goes through PostgREST instead of a direct Postgres
// connection: that would mean parking both database passwords in AWS.)

const TARGETS = [
  { name: 'dev', url: process.env.DEV_SUPABASE_URL, anonKey: process.env.DEV_SUPABASE_ANON_KEY },
  { name: 'prod', url: process.env.PROD_SUPABASE_URL, anonKey: process.env.PROD_SUPABASE_ANON_KEY },
]

async function ping({ name, url, anonKey }) {
  if (!url || !anonKey) throw new Error(`${name}: missing URL or anon key`)

  const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/Group?select=id&limit=1`, {
    headers: { apikey: anonKey },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    throw new Error(`${name}: HTTP ${res.status} ${body}`)
  }
  return `${name}: HTTP ${res.status}`
}

// One project being down (or already paused — its hostname stops resolving,
// so fetch throws) mustn't stop the other from being pinged, so every
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
      const reason = result.reason?.cause?.code
        ? `${TARGETS[i].name}: ${result.reason.message} (${result.reason.cause.code})`
        : result.reason?.message || String(result.reason)
      console.error(reason)
      failures.push(reason)
    }
  })

  if (failures.length > 0) throw new Error(`Supabase keep-alive failed — ${failures.join('; ')}`)
  return { ok: true }
}
