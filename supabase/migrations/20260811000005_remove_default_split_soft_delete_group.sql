-- Two corrections to 20260811000003_add_group_settings.sql, done as a
-- follow-up rather than editing that file in place — it's already applied
-- (dev), and this repo's convention (see db/README.md) is new files only
-- once a migration has landed anywhere.
--
-- 1. Drops the "default split evenly" setting entirely — not wanted.
-- 2. Makes group deletion soft: delete_group now just flips deleted_at
--    instead of cascading real DELETEs through Sessions/Payments/Members/
--    etc. Nothing is actually removed; the app just treats a deleted group
--    as gone (see the frontend's redirect-on-load and the home page filter).

-- ============================================================================
-- 1. Drop "default split evenly"
-- ============================================================================

DROP FUNCTION IF EXISTS public.set_group_default_split(bigint, boolean);

ALTER TABLE public."Group"
DROP COLUMN IF EXISTS default_split_even;

-- ============================================================================
-- 2. Soft delete — add the flag, redefine delete_group, and keep
--    find_group_by_pin from letting a deleted group be joined by pin.
-- ============================================================================

ALTER TABLE public."Group"
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

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

  UPDATE "Group" SET deleted_at = now() WHERE id = target_group_id;
END;
$$;

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
    AND g.archived_at IS NULL
    AND g.deleted_at IS NULL;
$$;
