-- Lets a member leave a group on their own initiative. This mirrors
-- remove_group_member's rules (must be an active member, balance must be
-- $0.00, the owner can't do it) but is caller-scoped rather than
-- owner-gated: the caller always removes themselves, never someone else, so
-- there's no is_group_owner() check here — just "are you an active member".

CREATE OR REPLACE FUNCTION public.leave_group(target_group_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id bigint;
  member_role text;
  member_balance numeric;
BEGIN
  SELECT u.id INTO caller_user_id
  FROM "User" u
  WHERE u.auth_user_id = auth.uid();

  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT role INTO member_role
  FROM "GroupMember"
  WHERE id = target_group_id AND user_id = caller_user_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active member of this group';
  END IF;

  IF member_role = 'owner' THEN
    RAISE EXCEPTION 'The group owner cannot leave the group';
  END IF;

  SELECT COALESCE(SUM(sp.amount), 0) INTO member_balance
  FROM "SessionPayment" sp
  JOIN "Session" s ON s.id = sp.session_id
  WHERE s.group_id = target_group_id
    AND sp.user_id = caller_user_id;

  IF ABS(member_balance) > 0.01 THEN
    RAISE EXCEPTION 'Your balance must be $0.00 before you can leave the group (currently %)', to_char(member_balance, 'FM$999,999,990.00');
  END IF;

  UPDATE "GroupMember" SET status = 'removed' WHERE id = target_group_id AND user_id = caller_user_id;
END;
$$;
