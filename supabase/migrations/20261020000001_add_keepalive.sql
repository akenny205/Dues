-- Written to by the keep-alive pinger (aws/supabase-keepalive) every few
-- days so a free-tier project never sits idle long enough to be paused.
-- The old ping was an anon REST read that RLS filtered down to nothing, and
-- Supabase didn't count it as activity — dev was paused anyway between
-- runs. This is a real write over a direct Postgres connection instead.
--
-- Always exactly one row (id = 1): the pinger upserts it, so the table never
-- grows. The pinger connects as postgres, which bypasses RLS — RLS is on
-- with no policies, and every grant to the API roles is revoked, so nothing
-- reaches this table through PostgREST.
CREATE TABLE IF NOT EXISTS public.keepalive (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pinged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.keepalive FROM anon, authenticated;
