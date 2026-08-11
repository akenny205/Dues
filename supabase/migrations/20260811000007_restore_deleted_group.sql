-- Un-deletes a group by clearing deleted_at — the counterpart to
-- delete_group (20260811000005). Surfaced on the account Settings page
-- (src/app/profile/page.tsx) as an "Archived Groups" list: a deleted group
-- redirects anyone away the moment its own page loads (see the frontend's
-- deleted_at check in loadGroup), so restoring it can't happen from within
-- the group itself — it has to be reachable from somewhere that isn't that
-- group's own page.
--
-- Ownership survives a delete untouched (delete_group never touches
-- GroupMember), so is_group_owner still resolves correctly here.

CREATE OR REPLACE FUNCTION public.restore_group(target_group_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can restore this group';
  END IF;

  UPDATE "Group" SET deleted_at = NULL WHERE id = target_group_id;
END;
$$;
