-- Add is_live column to Session table
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

ALTER TABLE public."Session" 
ADD COLUMN IF NOT EXISTS is_live boolean DEFAULT false;

-- Update existing sessions to be non-live (if needed)
UPDATE public."Session" 
SET is_live = false 
WHERE is_live IS NULL;

