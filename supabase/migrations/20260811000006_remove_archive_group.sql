-- Drops the archive/unarchive feature added in 20260811000003 — deletion
-- (soft, see 20260811000005) is the only retirement path for a group now.
-- Archiving would need its own "bring it back" UI to be worth the extra
-- state; not building that, so there's no reason to keep the half of it
-- that's already live on dev.

DROP FUNCTION IF EXISTS public.archive_group(bigint);
DROP FUNCTION IF EXISTS public.unarchive_group(bigint);

ALTER TABLE public."Group"
DROP COLUMN IF EXISTS archived_at;

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
    AND g.deleted_at IS NULL;
$$;
