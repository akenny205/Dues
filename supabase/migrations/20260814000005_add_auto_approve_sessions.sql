-- Lets a user opt out of manually clicking "Approve" on session approvals
-- that land on them. Two levels, not just on/off:
--   'live_only' — auto-approve just live-session closes, where the total
--     was already visible and had to sum to $0.00 before anyone could even
--     propose closing (see handleProposeCloseLiveSession) — the lowest-risk
--     case, since there's little left to actually review.
--   'all'       — auto-approve every kind of session approval: edits,
--     payments, settle-ups, new sessions that include you, and deletions.
-- Same self-scoped-only pattern as preferred_payment_method: a plain CHECK
-- constraint, no new RLS needed since "Users can update own profile"
-- already covers it at the row level.

ALTER TABLE public."User"
ADD COLUMN IF NOT EXISTS auto_approve_sessions character varying NOT NULL DEFAULT 'off';

ALTER TABLE public."User" DROP CONSTRAINT IF EXISTS user_auto_approve_sessions_check;
ALTER TABLE public."User"
ADD CONSTRAINT user_auto_approve_sessions_check
  CHECK (auto_approve_sessions IN ('off', 'live_only', 'all'));

-- No new RLS policies needed — same broad-read/self-write column as
-- preferred_payment_method, already covered by the policies in
-- 20260807000001_lockdown_rls.sql.
