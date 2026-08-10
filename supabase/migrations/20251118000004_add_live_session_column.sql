-- Converted from db/policies/add_live_session_column.sql (kept there for history).
-- Add is_live column to Session table.

ALTER TABLE public."Session"
ADD COLUMN IF NOT EXISTS is_live boolean DEFAULT false;

UPDATE public."Session"
SET is_live = false
WHERE is_live IS NULL;
