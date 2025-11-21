-- Add is_payment column to Session table
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

ALTER TABLE public."Session" 
ADD COLUMN IF NOT EXISTS is_payment boolean DEFAULT false;

-- Update existing sessions to be non-payment (if needed)
UPDATE public."Session" 
SET is_payment = false 
WHERE is_payment IS NULL;

