-- Follow-up to 20260811000008_add_group_banner.sql, done as a new file
-- rather than editing that one in place — it's already applied on dev (see
-- db/README.md's "new files only, never edit an existing migration once
-- it's been applied anywhere").
--
-- Lets Group.banner_url hold a flat color as an alternative to a photo: a
-- plain 6-digit hex string like #1f4739, alongside the existing
-- data:image/jpeg;base64,... shape. See src/lib/bannerColor.ts for the
-- shared "which shape is this" check the frontend uses to pick <img> vs a
-- plain background-color div. update_group_banner itself doesn't need to
-- change — it already just stores whatever text it's given, format-agnostic;
-- only the CHECK constraint needs to widen.

ALTER TABLE public."Group"
DROP CONSTRAINT IF EXISTS banner_url_is_small_jpeg_data_url;

ALTER TABLE public."Group"
DROP CONSTRAINT IF EXISTS banner_url_is_photo_or_color;

ALTER TABLE public."Group"
ADD CONSTRAINT banner_url_is_photo_or_color
CHECK (
  banner_url IS NULL
  OR banner_url ~ '^#[0-9a-fA-F]{6}$'
  OR (
    banner_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$'
    AND length(banner_url) <= 600000
  )
);
