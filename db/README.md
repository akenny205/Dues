# Database schema history

`supabase/migrations/*.sql` is the **only source of truth** for this
project's schema. Every change from here on goes through it (see below).

This project used to track schema changes as hand-written SQL files in
`db/policies/`, meant to be pasted into the Supabase SQL Editor by hand —
that folder has been deleted now that `supabase/migrations/` fully
supersedes it (each migration's header comment names which original file it
came from, for anyone who wants the old version — it's still in git history,
e.g. `git log -- db/policies`). One addition beyond a straight conversion:
`20251118000001_base_schema.sql`, covering the base tables that `db/schema.sql`
was supposed to describe but — by its own admission — wasn't actually
runnable (wrong table creation order relative to its own foreign keys). The
migrations version is the corrected, verified-against-the-live-schema
equivalent. `db/schema.sql` itself is left in place only as a quick-reference
snapshot; don't run it.

## Making a new schema change

```
npx supabase migration new some_change
```

writes a new timestamped file into `supabase/migrations/`. Put the change
there — new files only, never edit an existing migration once it's been
applied anywhere.

## Applying to dev / prod

```
npm run db:push:dev   # pushes to dev  (keqfynzhyyenbadmndps)
# test against dev, then:
npm run db:push:prod  # pushes to prod (oymugzcytglrxglorbvq)
```

These (`scripts/db-push.js`) push straight to a Postgres connection string
via `supabase db push --db-url`, read from `SUPABASE_DEV_DB_URL` /
`SUPABASE_PROD_DB_URL` in `.env.local` (see `.env.example`) — get each one
from that project's Dashboard > Project Settings > Database > Connection
string > "Direct connection", percent-encoding the password.

The script asks its own y/N confirmation before pushing, backed by a real
`--dry-run` — it lists only the migrations actually still pending, not
every file in `supabase/migrations/`. That's deliberately not just
`supabase db push`'s own built-in prompt: that one lists every local
migration file as a "candidate" regardless of what's already applied
remotely (only `--dry-run` and the real apply step diff correctly), so it's
misleading on its own. Once you confirm, the script pushes with `--yes` so
that misleading prompt never renders.

`db:push:prod` also refuses to run if dev isn't already caught up — it
`--dry-run`s dev first and aborts before touching prod if anything's still
pending there. There's no flag to skip this; run `db:push:dev` first.

That's deliberately *not* `supabase link` + `db push --linked`: the linked
path calls Supabase's `cli/login-role` management endpoint to provision a
short-lived DB role, which currently 400s on both our projects —
`42501: permission denied to alter role "cli_login_postgres"`. That's a
platform-side role-grant issue, not anything in this repo's migrations
(there's no `ALTER ROLE`/`GRANT`/`REVOKE` in any of them). `--db-url` skips
that provisioning step entirely. If Supabase fixes it, the simpler linked
flow below goes back to working too:

```
npx supabase link --project-ref <dev-ref>
npx supabase db push
# test locally against dev, then:
npx supabase link --project-ref <prod-ref>
npx supabase db push
```

Both projects' schemas were originally bootstrapped via `pg_dump`/`psql`
directly (see `db/prod-bootstrap.sql` locally — it's gitignored, not
committed), not through the CLI's migration tracker — so before the first
`db push` against either one, tell the CLI those migrations are already
applied (they are; this just registers that fact) rather than trying to
re-run them from scratch:

```
for f in supabase/migrations/*.sql; do
  version=$(basename "$f" | cut -d'_' -f1)
  npx supabase migration repair --status applied "$version" --db-url "$SUPABASE_DEV_DB_URL"  # or _PROD_
done
```

Run that once per project, before your first real `db push` against it —
**dev is already done** (as of the `payment_method` migration, 2026-08-10);
**prod still needs it** before its first push. Skip the newest migration(s)
you actually want pushed when running the loop, or just run it once against
an empty/synced tree and let the next real `db:push` pick up from there.
Every statement in these files is written defensively (`IF NOT EXISTS` /
`CREATE OR REPLACE`), so even skipping this step and letting `db push`
replay everything from scratch would very likely be a safe no-op for most
files — except plain `CREATE POLICY` ones (`20260807000001_lockdown_rls.sql`
in particular, which has no `DROP POLICY IF EXISTS` guard) will hard-fail
with `already exists` partway through, so don't rely on skipping this.
