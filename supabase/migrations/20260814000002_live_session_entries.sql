-- Redesigns live sessions: instead of one overwritable amount per person,
-- any active group member can add any number of entries during a live
-- session — for themselves or for someone else — and edit or delete any
-- entry once they're "involved" in that session. Closing now goes through
-- the same unanimous-approval machinery as any other session edit, instead
-- of finalizing instantly the moment one member hits Close.
--
-- Line items are scratch data: LiveSessionEntry only exists while a session
-- is live. The moment a close is fully approved, each person's entries are
-- summed into the one SessionPayment row per person the rest of the app
-- already expects, and the line items are discarded — nothing about the
-- dues calculation, settle-up, or the existing edit-approval system needs
-- to know multiple entries were ever involved.

-- ============================================================================
-- 1. LiveSessionEntry
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."LiveSessionEntry" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  session_id bigint NOT NULL,
  entered_by bigint NOT NULL,
  target_user_id bigint NOT NULL,
  amount numeric NOT NULL,
  note text,
  CONSTRAINT "LiveSessionEntry_pkey" PRIMARY KEY (id),
  CONSTRAINT "LiveSessionEntry_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public."Session"(id),
  CONSTRAINT "LiveSessionEntry_entered_by_fkey" FOREIGN KEY (entered_by) REFERENCES public."User"(id),
  CONSTRAINT "LiveSessionEntry_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES public."User"(id)
);

CREATE INDEX IF NOT EXISTS idx_live_session_entry_session ON public."LiveSessionEntry"(session_id);

-- ============================================================================
-- 2. What kind of approval this is — mirrors is_deletion
--    (20260807000005_add_deletion_approval.sql): a close proposal is a
--    per-participant "your final total is $X, confirm?" row, same shape as
--    an ordinary amount-change approval, just tagged so the finalize step
--    knows to also flip is_live and clear LiveSessionEntry.
-- ============================================================================

ALTER TABLE public."SessionEditApproval"
ADD COLUMN IF NOT EXISTS is_live_close boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 3. Helpers
-- ============================================================================

-- "Involved" = has at least one entry tied to them in this session (as
-- either the target or the enterer), or is the session's creator — the
-- creator counts even before their own first entry, since they're the one
-- who started it.
CREATE OR REPLACE FUNCTION public.is_involved_in_live_session(check_session_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  caller_user_id bigint;
BEGIN
  SELECT u.id INTO caller_user_id FROM "User" u WHERE u.auth_user_id = auth.uid();
  IF caller_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM "Session" s
    WHERE s.id = check_session_id AND s.created_by = caller_user_id
  ) OR EXISTS (
    SELECT 1 FROM "LiveSessionEntry" e
    WHERE e.session_id = check_session_id
      AND (e.entered_by = caller_user_id OR e.target_user_id = caller_user_id)
  );
END;
$$;

-- Entries can only be added/edited/deleted while the session is actually
-- live AND there's no close vote currently in progress — once a close is
-- proposed, the numbers being voted on have to stop moving.
CREATE OR REPLACE FUNCTION public.is_live_session_open_for_entry(check_session_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Session" s WHERE s.id = check_session_id AND s.is_live = true
  ) AND NOT EXISTS (
    SELECT 1 FROM "SessionEditApproval" a
    WHERE a.session_id = check_session_id AND a.status = 'pending'
  );
$$;

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public."LiveSessionEntry" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read live session entries"
ON public."LiveSessionEntry"
FOR SELECT
TO authenticated
USING (public.is_session_group_member(session_id));

-- Adding a new entry is wide open to any active member of the group — that's
-- how someone becomes "involved" in the first place — but only while the
-- session is actually open for entry, only as yourself (entered_by can't be
-- forged), and only for someone who's actually a member of this group.
CREATE POLICY "Members can add live session entries"
ON public."LiveSessionEntry"
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND entered_by IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
  AND target_user_id IN (
    SELECT gm.user_id FROM "GroupMember" gm
    JOIN "Session" s ON s.group_id = gm.id
    WHERE s.id = session_id AND gm.status = 'active'
  )
);

-- Editing/deleting an existing entry is open to anyone already involved in
-- this session (not just whoever created that specific entry — see
-- is_involved_in_live_session), still only while open for entry. This also
-- covers the bulk cleanup delete a close's finalize step does once
-- everyone's approved: by then every "pending" row is gone (they're all
-- "approved"), so is_live_session_open_for_entry is true again, and
-- whoever's finalizing is always involved (they're one of the approvers).
CREATE POLICY "Involved members can edit live session entries"
ON public."LiveSessionEntry"
FOR UPDATE
TO authenticated
USING (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND public.is_involved_in_live_session(session_id)
)
WITH CHECK (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND public.is_involved_in_live_session(session_id)
);

CREATE POLICY "Involved members can delete live session entries"
ON public."LiveSessionEntry"
FOR DELETE
TO authenticated
USING (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND public.is_involved_in_live_session(session_id)
);

-- ============================================================================
-- 5. Cancel — creator-only, unlike everyday live-session activity above.
--    Cancelling discards a draft outright (no approval needed to do it,
--    same as before), but who gets to pull that trigger is now restricted:
--    everyday entry add/edit/delete stays open to the whole group, same as
--    the rest of the app, but only the person who started this particular
--    session gets to throw it away, including mid-close-vote if they change
--    their mind. Same pattern as delete_group/remove_group_member: an
--    ownership check the RLS layer alone can't express, done in a
--    SECURITY DEFINER function instead.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_live_session(target_session_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id bigint;
  session_creator bigint;
  session_is_live boolean;
BEGIN
  SELECT u.id INTO caller_user_id FROM "User" u WHERE u.auth_user_id = auth.uid();

  SELECT created_by, is_live INTO session_creator, session_is_live
  FROM "Session" WHERE id = target_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF session_is_live IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'This session is already closed';
  END IF;

  IF caller_user_id IS NULL OR caller_user_id IS DISTINCT FROM session_creator THEN
    RAISE EXCEPTION 'Only the person who started this session can cancel it';
  END IF;

  DELETE FROM "SessionEditApproval" WHERE session_id = target_session_id;
  DELETE FROM "LiveSessionEntry" WHERE session_id = target_session_id;
  DELETE FROM "Session" WHERE id = target_session_id;
END;
$$;
