-- Converted from db/policies/add_group_pin.sql (kept there for history).
-- Add pin column to Group table, plus a generator for it.

ALTER TABLE public."Group"
ADD COLUMN IF NOT EXISTS pin character varying UNIQUE;

CREATE OR REPLACE FUNCTION generate_group_pin()
RETURNS text AS $$
DECLARE
  new_pin text;
  pin_exists boolean;
BEGIN
  LOOP
    new_pin := LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');

    SELECT EXISTS(SELECT 1 FROM public."Group" WHERE pin = new_pin) INTO pin_exists;

    IF NOT pin_exists THEN
      RETURN new_pin;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

UPDATE public."Group"
SET pin = generate_group_pin()
WHERE pin IS NULL;

ALTER TABLE public."Group"
ALTER COLUMN pin SET NOT NULL;
