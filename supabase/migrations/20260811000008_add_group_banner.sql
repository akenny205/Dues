-- Group banner photo — same client-resized data: URL approach as
-- User.avatar_url (see src/lib/avatar.ts and 20260809000002_add_avatar_url.sql),
-- but cropped to a wide strip instead of a square, and stored on Group.
--
-- Unlike avatar_url (gated by the tight "self can update own profile" RLS
-- policy), Group's RLS ("Members can update their groups",
-- 20260807000001_lockdown_rls.sql) is deliberately member-wide — every
-- member can UPDATE the row for everyday activity. Owner-only edits like
-- this one go through a SECURITY DEFINER RPC instead, same as
-- update_group_details/regenerate_group_pin/etc in
-- 20260811000003_add_group_settings.sql, rather than relying on RLS to gate
-- who's allowed to set it.
--
-- Briefly extended to also allow a flat color instead of a photo
-- (20260811000009_group_banner_color.sql), then reverted back to photo-only
-- (20260811000010_remove_group_banner_color.sql) — both as new files rather
-- than editing this one in place, since it's already applied on dev (see
-- db/README.md).

ALTER TABLE public."Group"
ADD COLUMN IF NOT EXISTS banner_url text;

-- Belt-and-suspenders, same reasoning as
-- 20260811000004_avatar_url_check_constraint.sql: the RPC below only checks
-- *who* can call it, not what they pass, so a caller going straight at
-- supabase.rpc (devtools, curl + their own JWT) could still hand it an
-- external URL or an oversized blob without this. Length cap is higher than
-- avatar_url's (200,000) because a wide banner has far more pixels than a
-- 160px square avatar — see resizeImageToBannerDataUrl.
ALTER TABLE public."Group"
DROP CONSTRAINT IF EXISTS banner_url_is_small_jpeg_data_url;

ALTER TABLE public."Group"
ADD CONSTRAINT banner_url_is_small_jpeg_data_url
CHECK (
  banner_url IS NULL
  OR (
    banner_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$'
    AND length(banner_url) <= 600000
  )
);

CREATE OR REPLACE FUNCTION public.update_group_banner(target_group_id bigint, new_banner_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_group_owner(target_group_id) THEN
    RAISE EXCEPTION 'Only the group owner can change the group banner';
  END IF;

  UPDATE "Group" SET banner_url = new_banner_url WHERE id = target_group_id;
END;
$$;
