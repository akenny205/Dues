-- Flips auto-approve (20260814000005) from opt-in to opt-out: 'all' is now
-- the default instead of 'off', so a session approval that lands on someone
-- is pre-approved unless they've gone into their profile and turned that
-- off (or down to 'live_only') themselves.
ALTER TABLE public."User"
ALTER COLUMN auto_approve_sessions SET DEFAULT 'all';

-- Existing accounts all got 'off' from the old column default, so there's
-- no way to tell someone who deliberately picked 'off' apart from someone
-- who never opened the setting — everyone currently on 'off' moves to the
-- new default. 'live_only' is left alone: that one can only ever have been
-- an explicit choice.
UPDATE public."User"
SET auto_approve_sessions = 'all'
WHERE auto_approve_sessions = 'off';
