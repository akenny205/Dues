-- Converted from db/policies/add_deletion_approval.sql (kept there for history).
--
-- Deleting a closed session now needs unanimous approval from everyone who
-- was part of it, same as editing one — not the unilateral, no-approval
-- delete it was before.
--
-- No new table: the audience for "does this deletion need your sign-off" is
-- identical to the audience for "does this edit need your sign-off" — every
-- participant in the session — so this reuses SessionEditApproval instead of
-- introducing a parallel approval system. is_deletion just distinguishes a
-- deletion proposal (every amount going to $0, then the session itself is
-- removed) from an ordinary amount-change proposal. No RLS change needed:
-- the existing "members of the session's group" policies on
-- SessionEditApproval already cover these rows too.

ALTER TABLE public."SessionEditApproval"
ADD COLUMN IF NOT EXISTS is_deletion boolean NOT NULL DEFAULT false;
