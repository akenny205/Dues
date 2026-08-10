-- Converted from db/policies/add_payment_column.sql (kept there for history).
-- Add is_payment column to Session table.

ALTER TABLE public."Session"
ADD COLUMN IF NOT EXISTS is_payment boolean DEFAULT false;

UPDATE public."Session"
SET is_payment = false
WHERE is_payment IS NULL;
