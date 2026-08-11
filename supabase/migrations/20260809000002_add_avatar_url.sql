-- Converted from db/policies/add_avatar_url.sql (kept there for history).
-- Add a profile picture to the User table. Stores a small (client-resized,
-- center-cropped) data: URL rather than a Supabase Storage path — there's no
-- storage bucket set up in this project yet, and a compressed ~150px JPEG
-- data URL is a few KB, well within a text column. See
-- src/lib/avatar.ts for the client-side resize and
-- src/components/ProfileModal.tsx for the upload UI.

ALTER TABLE public."User"
ADD COLUMN IF NOT EXISTS avatar_url text;

-- No new RLS policies needed — "Users can read all profiles" (broad SELECT)
-- and "Users can update own profile" (self-only UPDATE), both already in
-- 20260807000001_lockdown_rls.sql, cover this column the same as first_name/last_name.
-- Those policies gate *whose* row can be written, not what goes in it — see
-- 20260811000004_avatar_url_check_constraint.sql for the format/size check
-- that does that part.
