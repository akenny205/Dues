-- Converted from db/policies/add_member_removal.sql (kept there for history).
-- Requires 20260807000001_lockdown_rls.sql and 20260807000002_add_join_requests.sql
-- (redefines functions those introduced).
--
-- Lets the group owner remove a member without deleting any of their data.
-- Removal is a soft-delete: GroupMember.status flips to 'removed' rather than
-- the row being deleted, so User rows and every SessionPayment they were ever
-- part of stay exactly as they are — other members still see their real name
-- on old sessions, and if they rejoin later their whole history is still
-- there.

-- ============================================================================
-- 1. GroupMember gets a status. Existing rows all become 'active' for free —
--    ADD COLUMN ... NOT NULL DEFAULT backfills every existing row in one shot.
-- ============================================================================

ALTER TABLE public."GroupMember"
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'; -- 'active' | 'removed'

-- ============================================================================
-- 2. is_group_member / is_group_owner (from lockdown_rls.sql and
--    add_join_requests.sql) must only count *active* rows now — otherwise a
--    removed member's row would still satisfy every membership check and
--    removal wouldn't actually revoke access to Sessions/SessionPayment/etc.
-- ============================================================================

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

-- ============================================================================
-- 3. Rejoining after removal: approve_join_request (add_join_requests.sql)
--    used to assume the GroupMember row never existed. Now it might, just
--    marked 'removed' — upsert instead of insert-or-skip so rejoining
--    reactivates the same row (and, for free, keeps whatever role they had).
-- ============================================================================

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

-- ============================================================================
-- 4. remove_group_member — the owner-only action itself. Runs server-side so
--    it can touch someone else's GroupMember row (the owner's own RLS
--    permissions don't allow that directly), and enforces the $0-balance
--    rule for real rather than trusting the client to have checked it.
-- ============================================================================

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
