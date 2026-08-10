-- Converted from db/policies/add_session_payment_indexes.sql (kept there for history).
-- Index SessionPayment for the lookups the app actually makes.
-- Unlike SessionEditApproval, SessionPayment only ever had its primary key
-- indexed — everything else relied on a sequential scan that grows with the
-- table's *entire* size across every group, not just one.
--
-- Covers every actual query pattern against this table:
--   .eq('session_id', X)              -- per-session payment fetches, loadSessionDetails, etc.
--   .in('session_id', [...])          -- loadDues, bulk group-wide fetch
--   .eq('session_id', X).eq('user_id', Y)  -- upsertPayment's existence check, run on every write
-- A composite index on (session_id, user_id) serves all three: Postgres can use its
-- leftmost column (session_id) alone just as well as a single-column index would,
-- and the full pair gives the per-user lookup a direct hit instead of a scan.
CREATE INDEX IF NOT EXISTS idx_session_payment_session_user
ON public."SessionPayment"(session_id, user_id);
