-- Replaces the single delegated_to_user_id on LiveSessionGuest (20260814000003)
-- with a proper split: a guest's total no longer has to land on one person —
-- it can be divided across any number of session participants, in whatever
-- amounts they choose, as long as those amounts add up to exactly the
-- guest's total. Once delegated, each delegate's share folds into their own
-- total at close time, same as if they'd entered the amount themselves.

-- ============================================================================
-- 1. LiveSessionGuestDelegation — one row per (guest, delegate) pair, holding
--    how much of that guest's total this particular delegate is covering. A
--    guest can have zero, one, or several of these; the app (see
--    guestsNeedingDelegation) treats a guest as fully delegated once its
--    rows sum to exactly its entries' total, and blocks closing until then.
--    session_id is denormalized from the guest's own session purely so the
--    RLS below can check it without a join.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."LiveSessionGuestDelegation" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  session_id bigint NOT NULL,
  guest_id bigint NOT NULL,
  user_id bigint NOT NULL,
  amount numeric NOT NULL,
  CONSTRAINT "LiveSessionGuestDelegation_pkey" PRIMARY KEY (id),
  CONSTRAINT "LiveSessionGuestDelegation_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public."Session"(id),
  CONSTRAINT "LiveSessionGuestDelegation_guest_id_fkey" FOREIGN KEY (guest_id) REFERENCES public."LiveSessionGuest"(id) ON DELETE CASCADE,
  CONSTRAINT "LiveSessionGuestDelegation_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id),
  CONSTRAINT "LiveSessionGuestDelegation_guest_user_unique" UNIQUE (guest_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_live_session_guest_delegation_guest ON public."LiveSessionGuestDelegation"(guest_id);
CREATE INDEX IF NOT EXISTS idx_live_session_guest_delegation_session ON public."LiveSessionGuestDelegation"(session_id);

-- ============================================================================
-- 2. Drop LiveSessionGuest.delegated_to_user_id — its only policy has to go
--    first since it references the column being dropped. Nothing on a guest
--    row itself is ever edited after the fact (its name, creator, session
--    don't change) — splitting its total is entirely
--    LiveSessionGuestDelegation's job now — so there's no UPDATE policy on
--    LiveSessionGuest at all going forward.
-- ============================================================================

DROP POLICY IF EXISTS "Involved members can update live session guests" ON public."LiveSessionGuest";

ALTER TABLE public."LiveSessionGuest"
DROP CONSTRAINT IF EXISTS "LiveSessionGuest_delegated_to_user_id_fkey";

ALTER TABLE public."LiveSessionGuest"
DROP COLUMN IF EXISTS delegated_to_user_id;

-- ============================================================================
-- 3. is_involved_in_live_session — re-pointed from delegated_to_user_id to
--    LiveSessionGuestDelegation; being a delegate on any guest in the
--    session counts as involvement, same as before.
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
    WHERE g.session_id = check_session_id AND g.created_by = caller_user_id
  ) OR EXISTS (
    SELECT 1 FROM "LiveSessionGuestDelegation" d
    WHERE d.session_id = check_session_id AND d.user_id = caller_user_id
  );
END;
$$;

-- Whether check_user_id has actually participated in this live session —
-- entered something, been entered for, or started it — as opposed to just
-- being some other active member of the group. Guests can only be delegated
-- to people who are actually "in the session" this way; an active group
-- member who's never touched this particular session isn't eligible (see
-- the LiveSessionGuestDelegation RLS below).
CREATE OR REPLACE FUNCTION public.is_live_session_participant(check_session_id bigint, check_user_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Session" s WHERE s.id = check_session_id AND s.created_by = check_user_id
  ) OR EXISTS (
    SELECT 1 FROM "LiveSessionEntry" e
    WHERE e.session_id = check_session_id
      AND (e.entered_by = check_user_id OR e.target_user_id = check_user_id)
  );
$$;

-- ============================================================================
-- 4. LiveSessionGuestDelegation RLS — managing a guest's split (add a
--    delegate, change one's amount, remove one) is restricted to involved
--    members, same as the guest itself. The delegate being assigned always
--    has to be an active member who's actually a participant in this
--    session (see is_live_session_participant) — someone outside the
--    session entirely can never end up owing a share of a guest's tab.
-- ============================================================================

ALTER TABLE public."LiveSessionGuestDelegation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read live session guest delegations"
ON public."LiveSessionGuestDelegation"
FOR SELECT
TO authenticated
USING (public.is_session_group_member(session_id));

CREATE POLICY "Involved members can add live session guest delegations"
ON public."LiveSessionGuestDelegation"
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND public.is_involved_in_live_session(session_id)
  AND guest_id IN (SELECT g.id FROM "LiveSessionGuest" g WHERE g.session_id = session_id)
  AND public.is_live_session_participant(session_id, user_id)
  AND user_id IN (
    SELECT gm.user_id FROM "GroupMember" gm
    JOIN "Session" s ON s.group_id = gm.id
    WHERE s.id = session_id AND gm.status = 'active'
  )
);

CREATE POLICY "Involved members can update live session guest delegations"
ON public."LiveSessionGuestDelegation"
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
  AND guest_id IN (SELECT g.id FROM "LiveSessionGuest" g WHERE g.session_id = session_id)
  AND public.is_live_session_participant(session_id, user_id)
  AND user_id IN (
    SELECT gm.user_id FROM "GroupMember" gm
    JOIN "Session" s ON s.group_id = gm.id
    WHERE s.id = session_id AND gm.status = 'active'
  )
);

CREATE POLICY "Involved members can delete live session guest delegations"
ON public."LiveSessionGuestDelegation"
FOR DELETE
TO authenticated
USING (
  public.is_session_group_member(session_id)
  AND public.is_live_session_open_for_entry(session_id)
  AND public.is_involved_in_live_session(session_id)
);

-- ============================================================================
-- 5. cancel_live_session — needs to clear guest delegations too now.
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
  DELETE FROM "LiveSessionGuestDelegation" WHERE session_id = target_session_id;
  DELETE FROM "LiveSessionGuest" WHERE session_id = target_session_id;
  DELETE FROM "Session" WHERE id = target_session_id;
END;
$$;
