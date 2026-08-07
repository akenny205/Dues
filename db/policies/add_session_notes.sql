-- Lets any group member attach a free-text note to a session, but only the
-- person who created it can ever change that note. Run this in the
-- Supabase SQL Editor.
--
-- Why a function instead of just widening the Session UPDATE policy: RLS
-- policies apply per-row, not per-column — the existing "any member can
-- update sessions" policy (needed for closing live sessions, editing
-- descriptions, etc.) can't simultaneously say "...except the notes column,
-- which only the creator can touch." A SECURITY DEFINER function sidesteps
-- that by checking creator-ship itself before writing, same pattern as
-- remove_group_member and approve/reject_join_request.

ALTER TABLE public."Session"
ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public."Session"
ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES public."User"(id);

CREATE OR REPLACE FUNCTION public.update_session_notes(target_session_id bigint, new_notes text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sess RECORD;
  caller_id bigint;
BEGIN
  SELECT id INTO caller_id FROM "User" WHERE auth_user_id = auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO sess FROM "Session" WHERE id = target_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF NOT public.is_session_group_member(target_session_id) THEN
    RAISE EXCEPTION 'Not a member of this session''s group';
  END IF;

  -- Sessions created before this migration have no recorded creator — allow
  -- any member to add notes to those rather than locking them out forever.
  -- Every session created from here on always has created_by set, so this
  -- fallback only ever applies to old data.
  IF sess.created_by IS NOT NULL AND sess.created_by != caller_id THEN
    RAISE EXCEPTION 'Only the person who created this session can edit its notes';
  END IF;

  UPDATE "Session" SET notes = new_notes WHERE id = target_session_id;
END;
$$;
