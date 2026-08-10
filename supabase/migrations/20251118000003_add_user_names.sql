-- Converted from db/policies/add_user_names.sql (kept there for history).
-- Add first_name and last_name columns to User table.

ALTER TABLE public."User"
ADD COLUMN IF NOT EXISTS first_name character varying,
ADD COLUMN IF NOT EXISTS last_name character varying;

-- One-time backfill for existing rows.
UPDATE public."User"
SET first_name = username, last_name = ''
WHERE first_name IS NULL;
