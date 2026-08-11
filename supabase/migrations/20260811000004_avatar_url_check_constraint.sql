-- Belt-and-suspenders for the avatar upload in src/lib/avatar.ts.
--
-- The client always re-encodes whatever image you pick through a <canvas>
-- and only ever writes a small `data:image/jpeg;base64,...` string — but
-- that's a client-side convention, not a guarantee. RLS ("Users can update
-- own profile", 20260807000001_lockdown_rls.sql) only checks *whose* row is
-- being written, not what's in it, so anyone can bypass the browser entirely
-- (devtools, curl + their own JWT) and PATCH avatar_url directly. Without a
-- DB-level check, that lets a user park an arbitrary string there — an
-- external image URL (which every group-mate's browser then fetches,
-- leaking their IP to whoever controls that host), a non-image data URI, or
-- a many-megabyte blob that gets pulled down on every member-list render
-- for the whole group.
--
-- This constraint makes the "small, client-resized JPEG data URL" contract
-- actually enforced: only that shape is accepted, capped well above what a
-- real 160px avatar produces (typically a few KB) but nowhere near large
-- enough to be a meaningful DoS payload.
ALTER TABLE public."User"
DROP CONSTRAINT IF EXISTS avatar_url_is_small_jpeg_data_url;

ALTER TABLE public."User"
ADD CONSTRAINT avatar_url_is_small_jpeg_data_url
CHECK (
  avatar_url IS NULL
  OR (
    avatar_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$'
    AND length(avatar_url) <= 200000
  )
);
