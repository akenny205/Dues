-- With auto-approve on by default (20261001000001), an edit to a session
-- usually applies the instant it's saved — and the SessionEditApproval rows
-- that carried its old/new amounts are deleted as soon as it's applied (see
-- finalizeSessionIfFullyApproved in src/app/groups/[id]/page.tsx). Nothing
-- was left to tell the people it affected that anything changed, or to show
-- what a session looked like before.
--
-- This table is that record. One row per person per applied edit, written
-- by the client at the moment an edit to an already-existing session is
-- applied (not for brand-new sessions, payments, settle ups, live-session
-- closes, or deletions — only edits). It does two jobs:
--
--   • version history — every row for a session, grouped by edit_id, is
--     "edit N: who changed it, when, and each person's amount before and
--     after". Never deleted on its own; goes away with the session.
--   • the alert — a row whose dismissed_at is still NULL is an edit that
--     landed on user_id without them ever seeing it (their approval was
--     auto-approved), and shows in their Notifications until they dismiss
--     it. Rows for the editor themselves, or for someone who clicked
--     Approve by hand, are written already-dismissed: they know.
CREATE TABLE IF NOT EXISTS public."SessionEditHistory" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  session_id bigint NOT NULL,
  edit_id uuid NOT NULL, -- shared by every row written for the same edit
  editor_user_id bigint,
  user_id bigint NOT NULL,
  old_amount numeric NOT NULL DEFAULT 0,
  new_amount numeric NOT NULL DEFAULT 0,
  dismissed_at timestamp with time zone,
  CONSTRAINT "SessionEditHistory_pkey" PRIMARY KEY (id),
  -- CASCADE: a session's history has nothing to describe once the session
  -- itself is deleted, and without it every existing delete path
  -- (performSessionDeletion, cancel_live_session, ...) would start failing
  -- on this foreign key.
  CONSTRAINT "SessionEditHistory_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public."Session"(id) ON DELETE CASCADE,
  CONSTRAINT "SessionEditHistory_editor_user_id_fkey" FOREIGN KEY (editor_user_id) REFERENCES public."User"(id) ON DELETE SET NULL,
  CONSTRAINT "SessionEditHistory_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_edit_history_session ON public."SessionEditHistory"(session_id);
CREATE INDEX IF NOT EXISTS idx_session_edit_history_undismissed ON public."SessionEditHistory"(user_id) WHERE dismissed_at IS NULL;

ALTER TABLE public."SessionEditHistory" ENABLE ROW LEVEL SECURITY;

-- Same visibility as the session's payments: anyone in the group can read
-- its history.
DROP POLICY IF EXISTS "Members can read edit history" ON public."SessionEditHistory";
CREATE POLICY "Members can read edit history"
ON public."SessionEditHistory"
FOR SELECT
TO authenticated
USING (public.is_session_group_member(session_id));

-- Whoever's client applies the edit writes the rows — the editor when
-- everything auto-approved, otherwise the last person to approve — so this
-- can't be narrowed to "editor_user_id is the caller". Same trust level as
-- SessionPayment itself, which any group member can already write.
DROP POLICY IF EXISTS "Members can record edit history" ON public."SessionEditHistory";
CREATE POLICY "Members can record edit history"
ON public."SessionEditHistory"
FOR INSERT
TO authenticated
WITH CHECK (public.is_session_group_member(session_id));

-- Dismissing your own alert is the only change anyone gets to make to a
-- history row: the policy limits it to your own rows, and the column grant
-- below limits it to dismissed_at — the amounts and who/when can't be
-- rewritten after the fact. No DELETE policy at all: rows only ever go away
-- with their session, via the cascade above.
DROP POLICY IF EXISTS "Users can dismiss own edit notices" ON public."SessionEditHistory";
CREATE POLICY "Users can dismiss own edit notices"
ON public."SessionEditHistory"
FOR UPDATE
TO authenticated
USING (user_id IN (SELECT id FROM public."User" WHERE auth_user_id = auth.uid()))
WITH CHECK (user_id IN (SELECT id FROM public."User" WHERE auth_user_id = auth.uid()));

REVOKE UPDATE ON public."SessionEditHistory" FROM authenticated, anon;
GRANT UPDATE (dismissed_at) ON public."SessionEditHistory" TO authenticated;
