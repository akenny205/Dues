-- Reconciles real schema/RLS/function drift discovered while pushing
-- 20260814000001: on dev, several earlier migrations are recorded as
-- applied in supabase_migrations.schema_migrations but their actual DDL
-- never took effect — most visibly, 20260807000003_add_member_removal.sql
-- (GroupMember.status, the status-aware is_group_member/is_group_owner,
-- and remove_group_member itself are all missing), but also several of the
-- "DROP the old wide-open policy" statements from
-- 20260807000001_lockdown_rls.sql across nearly every table. Postgres OR's
-- multiple permissive policies for the same command together, so wherever
-- an old USING/WITH CHECK (true) policy is still sitting next to its
-- intended replacement, the old one silently wins and the replacement does
-- nothing — meaning most of the member-scoping this app is supposed to
-- have has not actually been enforced on dev.
--
-- (Confirmed directly against dev via psql: pg_policies still lists e.g.
-- "Users can create group members" WITH CHECK (true) alongside "Creator
-- can seat themselves as owner of their new group"; GroupMember has no
-- status column; remove_group_member doesn't exist; "Users can insert own
-- profile" has WITH CHECK (true) instead of the email/auth_user_id check
-- it's supposed to have.)
--
-- Every statement below is idempotent (DROP POLICY IF EXISTS, ADD COLUMN IF
-- NOT EXISTS, CREATE OR REPLACE FUNCTION) and only re-asserts what earlier
-- migrations already claim to have done — this is safe to run against a
-- database that's already correct (every statement becomes a no-op), which
-- matters because prod may or may not have the same drift and hasn't been
-- checked yet.

-- ============================================================================
-- 1. Drop every leftover pre-lockdown policy still active alongside its
--    replacement. Named exactly as they appear in pg_policies on dev.
-- ============================================================================

DROP POLICY IF EXISTS "Users can read all groups" ON public."Group";
DROP POLICY IF EXISTS "Users can update own groups" ON public."Group";

DROP POLICY IF EXISTS "Users can create group members" ON public."GroupMember";
DROP POLICY IF EXISTS "Users can read group members" ON public."GroupMember";
DROP POLICY IF EXISTS "Users can update group members" ON public."GroupMember";

DROP POLICY IF EXISTS "Users can create invites" ON public."Invite";
DROP POLICY IF EXISTS "Users can read invites" ON public."Invite";
DROP POLICY IF EXISTS "Users can update invites" ON public."Invite";

DROP POLICY IF EXISTS "Users can create sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can read all sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can update sessions" ON public."Session";

DROP POLICY IF EXISTS "Users can create approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can delete approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can read approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can update approval records" ON public."SessionEditApproval";

DROP POLICY IF EXISTS "Users can create payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can delete payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can read all payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can update own payments" ON public."SessionPayment";

-- ============================================================================
-- 2. "Users can insert own profile" exists under the right name but with
--    the wrong (pre-lockdown, unrestricted) body — replace it outright
--    rather than drop+recreate under a new name, since the name itself is
--    already correct.
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert own profile" ON public."User";

CREATE POLICY "Users can insert own profile"
ON public."User"
FOR INSERT
TO authenticated
WITH CHECK (
  email = (auth.jwt() ->> 'email')
  AND auth_user_id = auth.uid()
);

-- ============================================================================
-- 3. GroupMember.status and everything that depends on it — copied
--    verbatim from 20260807000003_add_member_removal.sql, since that
--    migration's DDL is what never actually landed.
-- ============================================================================

ALTER TABLE public."GroupMember"
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE OR REPLACE FUNCTION public.is_group_member(check_group_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "GroupMember" gm
    JOIN "User" u ON u.id = gm.user_id
    WHERE gm.id = check_group_id
      AND u.auth_user_id = auth.uid()
      AND gm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(check_group_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "GroupMember" gm
    JOIN "User" u ON u.id = gm.user_id
    WHERE gm.id = check_group_id
      AND u.auth_user_id = auth.uid()
      AND gm.role = 'owner'
      AND gm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.approve_join_request(request_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM "JoinRequest" WHERE id = request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found or already resolved';
  END IF;

  IF NOT public.is_group_owner(req.group_id) THEN
    RAISE EXCEPTION 'Only the group owner can approve join requests';
  END IF;

  INSERT INTO "GroupMember" (id, user_id, role, status)
  VALUES (req.group_id, req.user_id, 'member', 'active')
  ON CONFLICT (id, user_id) DO UPDATE SET status = 'active';

  DELETE FROM "JoinRequest" WHERE id = request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_member(target_group_id bigint, target_user_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_role text;
  member_balance numeric;
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can remove members';
  END IF;

  SELECT role INTO member_role
  FROM "GroupMember"
  WHERE id = target_group_id AND user_id = target_user_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not an active member of this group';
  END IF;

  IF member_role = 'owner' THEN
    RAISE EXCEPTION 'The group owner cannot be removed';
  END IF;

  SELECT COALESCE(SUM(sp.amount), 0) INTO member_balance
  FROM "SessionPayment" sp
  JOIN "Session" s ON s.id = sp.session_id
  WHERE s.group_id = target_group_id
    AND sp.user_id = target_user_id;

  IF ABS(member_balance) > 0.01 THEN
    RAISE EXCEPTION 'This member''s balance must be $0.00 before they can be removed (currently %)', to_char(member_balance, 'FM$999,999,990.00');
  END IF;

  UPDATE "GroupMember" SET status = 'removed' WHERE id = target_group_id AND user_id = target_user_id;
END;
$$;
