-- Add first_name and last_name columns to User table
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

ALTER TABLE public."User" 
ADD COLUMN IF NOT EXISTS first_name character varying,
ADD COLUMN IF NOT EXISTS last_name character varying;

-- Update existing users to have first_name and last_name from username if they don't have them
-- This is a one-time migration for existing data
UPDATE public."User" 
SET first_name = username, last_name = ''
WHERE first_name IS NULL;

