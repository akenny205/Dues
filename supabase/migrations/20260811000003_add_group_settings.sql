-- Group-level settings: rename/description, join pin regenerate/disable,
-- default split behavior for new sessions, archive/delete, and ownership
-- transfer. All of these are owner-only actions (unlike everyday group
-- activity — creating sessions, adding payments — which stays open to every
-- member per the "no owner-only gating" note in lockdown_rls.sql). Each one
-- gets its own SECURITY DEFINER RPC, gated with is_group_owner(), same
-- pattern as remove_group_member.

-- ============================================================================
-- 1. New Group columns
-- ============================================================================

ALTER TABLE public."Group"
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS pin_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS default_split_even boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ============================================================================
-- 2. find_group_by_pin (from lockdown_rls.sql) — a disabled pin or an
--    archived group shouldn't be joinable by pin anymore.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_group_by_pin(input_pin text)
RETURNS TABLE(id bigint, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.id, g.name
  FROM "Group" g
  WHERE g.pin = input_pin
    AND g.pin_enabled = true
    AND g.archived_at IS NULL;
$$;

-- ============================================================================
-- 3. Rename / description
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_group_details(target_group_id bigint, new_name text, new_description text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can change group details';
  END IF;

  IF new_name IS NULL OR btrim(new_name) = '' THEN
    RAISE EXCEPTION 'Group name cannot be empty';
  END IF;

  UPDATE "Group"
  SET name = btrim(new_name),
      description = NULLIF(btrim(COALESCE(new_description, '')), '')
  WHERE id = target_group_id;
END;
$$;

-- ============================================================================
-- 4. Join pin — regenerate, or enable/disable without changing the value
-- ============================================================================

CREATE OR REPLACE FUNCTION public.regenerate_group_pin(target_group_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_pin text;
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can regenerate the join pin';
  END IF;

  new_pin := public.generate_group_pin();
  UPDATE "Group" SET pin = new_pin WHERE id = target_group_id;
  RETURN new_pin;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_group_pin_enabled(target_group_id bigint, enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can enable or disable the join pin';
  END IF;

  UPDATE "Group" SET pin_enabled = enabled WHERE id = target_group_id;
END;
$$;

-- ============================================================================
-- 5. Default split behavior — when on, a new session starts with every
--    active member already added (instead of just the creator), so
--    "Split evenly" is one click away. See handleAddSessionClick.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_group_default_split(target_group_id bigint, enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can change the default split behavior';
  END IF;

  UPDATE "Group" SET default_split_even = enabled WHERE id = target_group_id;
END;
$$;

-- ============================================================================
-- 6. Archive / unarchive — a soft, reversible way to retire a group without
--    losing its history. Archived groups are filtered out of the main group
--    list on the home page and can no longer be joined by pin (see #2).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.archive_group(target_group_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can archive this group';
  END IF;

  UPDATE "Group" SET archived_at = now() WHERE id = target_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unarchive_group(target_group_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can unarchive this group';
  END IF;

  UPDATE "Group" SET archived_at = NULL WHERE id = target_group_id;
END;
$$;

-- ============================================================================
-- 7. Delete — permanent, cascades through everything the group owns. No FK
--    is set up with ON DELETE CASCADE (see base_schema.sql), so this deletes
--    child rows itself, in dependency order, inside one function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_group(target_group_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can delete this group';
  END IF;

  DELETE FROM "SessionEditApproval"
  WHERE session_id IN (SELECT id FROM "Session" WHERE group_id = target_group_id);

  DELETE FROM "SessionPayment"
  WHERE session_id IN (SELECT id FROM "Session" WHERE group_id = target_group_id);

  DELETE FROM "Session" WHERE group_id = target_group_id;
  DELETE FROM "JoinRequest" WHERE group_id = target_group_id;
  DELETE FROM "Invite" WHERE group_id = target_group_id;
  DELETE FROM "GroupMember" WHERE id = target_group_id;
  DELETE FROM "Group" WHERE id = target_group_id;
END;
$$;

-- ============================================================================
-- 8. Transfer ownership — the new owner must already be an active member.
--    The caller (current owner) demotes to 'member' in the same statement,
--    so there's never a moment with two owners or zero owners.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.transfer_group_ownership(target_group_id bigint, new_owner_user_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id bigint;
  new_owner_status text;
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can transfer ownership';
  END IF;

  SELECT u.id INTO caller_user_id
  FROM "User" u
  WHERE u.auth_user_id = auth.uid();

  IF new_owner_user_id = caller_user_id THEN
    RAISE EXCEPTION 'You are already the owner';
  END IF;

  SELECT status INTO new_owner_status
  FROM "GroupMember"
  WHERE id = target_group_id AND user_id = new_owner_user_id;

  IF new_owner_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'That person is not an active member of this group';
  END IF;

  UPDATE "GroupMember" SET role = 'owner' WHERE id = target_group_id AND user_id = new_owner_user_id;
  UPDATE "GroupMember" SET role = 'member' WHERE id = target_group_id AND user_id = caller_user_id;
END;
$$;
