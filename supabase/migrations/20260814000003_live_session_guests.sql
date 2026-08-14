-- Lets a live session include people who aren't group members — a one-off
-- guest at the poker night, say — as a temporary placeholder rather than
-- requiring them to have a real account. A guest can accrue entries exactly
-- like a real member while the session is live, but since there's no User
-- row behind them (no login, no balance that persists after this session),
-- their running total has to be handed off to a real, active group member
-- — "delegated" — before the session can close. Once delegated, their
-- entries fold into that member's own total at close time, same as if the
-- member had entered the amounts themselves.
--
-- Live-session only, by design: a guest only ever makes sense as scratch
-- data inside a single in-progress session (see 20260814000002's "collapse
-- at close" comment) — there's no equivalent concept for a regular session,
-- whose amounts are always real SessionPayment rows tied to real members.

-- ============================================================================
-- 1. LiveSessionGuest — one row per guest per session. delegated_to_user_id
--    starts NULL and is set by any involved member (see is_involved_in_live_
--    session below) picking who's covering this guest's total.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."LiveSessionGuest" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  session_id bigint NOT NULL,
  name text NOT NULL,
  created_by bigint NOT NULL,
  delegated_to_user_id bigint,
  CONSTRAINT "LiveSessionGuest_pkey" PRIMARY KEY (id),
  CONSTRAINT "LiveSessionGuest_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public."Session"(id),
  CONSTRAINT "LiveSessionGuest_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."User"(id),
  CONSTRAINT "LiveSessionGuest_delegated_to_user_id_fkey" FOREIGN KEY (delegated_to_user_id) REFERENCES public."User"(id)
);

CREATE INDEX IF NOT EXISTS idx_live_session_guest_session ON public."LiveSessionGuest"(session_id);

-- ============================================================================
-- 2. LiveSessionEntry — target_user_id becomes optional, target_guest_id is
--    its guest-shaped counterpart. Exactly one of the two is ever set; the
--    CHECK constraint is the real guarantee here, not app code. Deleting a
--    guest takes their entries with them (ON DELETE CASCADE) rather than
--    leaving orphaned rows with nobody to attribute them to.
-- ============================================================================

ALTER TABLE public."LiveSessionEntry"
ALTER COLUMN target_user_id DROP NOT NULL;

ALTER TABLE public."LiveSessionEntry"
ADD COLUMN IF NOT EXISTS target_guest_id bigint;

ALTER TABLE public."LiveSessionEntry"
DROP CONSTRAINT IF EXISTS "LiveSessionEntry_target_guest_id_fkey";

ALTER TABLE public."LiveSessionEntry"
ADD CONSTRAINT "LiveSessionEntry_target_guest_id_fkey"
FOREIGN KEY (target_guest_id) REFERENCES public."LiveSessionGuest"(id) ON DELETE CASCADE;

ALTER TABLE public."LiveSessionEntry"
DROP CONSTRAINT IF EXISTS live_session_entry_exactly_one_target;

ALTER TABLE public."LiveSessionEntry"
ADD CONSTRAINT live_session_entry_exactly_one_target CHECK (
  (target_user_id IS NOT NULL AND target_guest_id IS NULL)
  OR (target_user_id IS NULL AND target_guest_id IS NOT NULL)
);

-- ============================================================================
-- 3. is_involved_in_live_session — extended so creating a guest, or being
--    delegated one, counts as involvement too (matters for who can edit/
--    delete entries and who can change a delegation — see the RLS below).
-- ============================================================================

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
  ) OR EXISTS (
    SELECT 1 FROM "LiveSessionGuest" g
    WHERE g.session_id = check_session_id
      AND (g.created_by = caller_user_id OR g.delegated_to_user_id = caller_user_id)
  );
END;
$$;

-- ============================================================================
-- 4. LiveSessionEntry INSERT — superseded from 20260814000002 to accept a
--    guest target as an alternative to a member target.
-- ============================================================================

DROP POLICY IF EXISTS "Members can add live session entries" ON public."LiveSessionEntry";

CREATE POLICY "Members can add live session entries"
ON public."LiveSessionEntry"
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND entered_by IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
  AND (
    (
      target_user_id IS NOT NULL
      AND target_user_id IN (
        SELECT gm.user_id FROM "GroupMember" gm
        JOIN "Session" s ON s.group_id = gm.id
        WHERE s.id = session_id AND gm.status = 'active'
      )
    )
    OR (
      target_guest_id IS NOT NULL
      AND target_guest_id IN (SELECT g.id FROM "LiveSessionGuest" g WHERE g.session_id = session_id)
    )
  )
);

-- ============================================================================
-- 5. LiveSessionGuest RLS — adding a guest is as open as adding an entry
--    (any group member, while the session is open for entry); changing who
--    a guest is delegated to, or removing a guest outright, is restricted
--    to involved members, same rule as editing/deleting an entry.
-- ============================================================================

ALTER TABLE public."LiveSessionGuest" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read live session guests"
ON public."LiveSessionGuest"
FOR SELECT
TO authenticated
USING (public.is_session_group_member(session_id));

CREATE POLICY "Members can add live session guests"
ON public."LiveSessionGuest"
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND created_by IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
);

CREATE POLICY "Involved members can update live session guests"
ON public."LiveSessionGuest"
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
  AND (
    delegated_to_user_id IS NULL
    OR delegated_to_user_id IN (
      SELECT gm.user_id FROM "GroupMember" gm
      JOIN "Session" s ON s.group_id = gm.id
      WHERE s.id = session_id AND gm.status = 'active'
    )
  )
);

CREATE POLICY "Involved members can delete live session guests"
ON public."LiveSessionGuest"
FOR DELETE
TO authenticated
USING (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND public.is_involved_in_live_session(session_id)
);

-- ============================================================================
-- 6. cancel_live_session — needs to clear guests too now.
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
  DELETE FROM "LiveSessionGuest" WHERE session_id = target_session_id;
  DELETE FROM "Session" WHERE id = target_session_id;
END;
$$;
