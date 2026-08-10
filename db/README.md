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
npx supabase link --project-ref <dev-ref>
npx supabase db push
# test locally against dev, then:
npx supabase link --project-ref <prod-ref>
npx supabase db push
```

Both projects' schemas were originally bootstrapped via `pg_dump`/`psql`
directly (see `db/prod-bootstrap.sql` locally — it's gitignored, not
committed), not through the CLI's migration tracker — so before the first
`db push` against either one, tell the CLI
those 17 migrations are already applied (they are; this just registers that
fact) rather than trying to re-run them from scratch:

```
for f in supabase/migrations/*.sql; do
  version=$(basename "$f" | cut -d'_' -f1)
  npx supabase migration repair --status applied "$version"
done
```

Run that once per project, right after linking to it and before your first
real `db push`. Every statement in these files is written defensively
(`IF NOT EXISTS` / `CREATE OR REPLACE`), so even skipping this step and
letting `db push` replay everything from scratch would very likely be a safe
no-op — but `migration repair` is the correct, guaranteed-safe way to do it.
