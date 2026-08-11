-- Removes solid-color banner support, added in
-- 20260811000009_group_banner_color.sql — Group.banner_url is photo-only
-- again. Product decision, not a bug: dropping this as a new file rather
-- than editing 20260811000009 in place since that one's already applied on
-- dev (see db/README.md).
--
-- A plain ADD CONSTRAINT (no NOT VALID) validates every existing row before
-- it'll apply, so any group currently sitting on a hex-color banner_url
-- (from testing the now-removed color picker) needs clearing first or this
-- migration fails outright.
UPDATE public."Group"
SET banner_url = NULL
WHERE banner_url IS NOT NULL
  AND banner_url !~ '^data:image/jpeg;base64,';

ALTER TABLE public."Group"
DROP CONSTRAINT IF EXISTS banner_url_is_photo_or_color;

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
