-- Add pin column to Group table
-- Run this in your Supabase SQL Editor

ALTER TABLE public."Group" 
ADD COLUMN IF NOT EXISTS pin character varying UNIQUE;

-- Create a function to generate a random 6-digit pin
CREATE OR REPLACE FUNCTION generate_group_pin() 
RETURNS text AS $$
DECLARE
  new_pin text;
  pin_exists boolean;
BEGIN
  LOOP
    -- Generate a 6-digit pin
    new_pin := LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');
    
    -- Check if pin already exists
    SELECT EXISTS(SELECT 1 FROM public."Group" WHERE pin = new_pin) INTO pin_exists;
    
    -- If pin doesn't exist, return it
    IF NOT pin_exists THEN
      RETURN new_pin;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Update existing groups to have pins (if they don't have one)
UPDATE public."Group" 
SET pin = generate_group_pin() 
WHERE pin IS NULL;

-- Make pin NOT NULL after setting values
ALTER TABLE public."Group" 
ALTER COLUMN pin SET NOT NULL;

