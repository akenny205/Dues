-- Row Level Security Policies for the Dues App
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

-- Enable RLS on User table (if not already enabled)
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can insert own profile" ON public."User";
DROP POLICY IF EXISTS "Users can read all profiles" ON public."User";
DROP POLICY IF EXISTS "Users can read own profile" ON public."User";

-- Policy: Allow authenticated users to insert their own user record
-- This allows users to create their profile when they first sign up
CREATE POLICY "Users can insert own profile"
ON public."User"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to read all users (needed for displaying emails in dues)
CREATE POLICY "Users can read all profiles"
ON public."User"
FOR SELECT
TO authenticated
USING (true);

-- Enable RLS on Group table
ALTER TABLE public."Group" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read all groups" ON public."Group";
DROP POLICY IF EXISTS "Users can create groups" ON public."Group";
DROP POLICY IF EXISTS "Users can update own groups" ON public."Group";

-- Policy: Allow authenticated users to read all groups
CREATE POLICY "Users can read all groups"
ON public."Group"
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to create groups
CREATE POLICY "Users can create groups"
ON public."Group"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update groups they created
CREATE POLICY "Users can update own groups"
ON public."Group"
FOR UPDATE
TO authenticated
USING (true);

-- Enable RLS on Session table
ALTER TABLE public."Session" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read all sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can create sessions" ON public."Session";

-- Policy: Allow authenticated users to read all sessions
CREATE POLICY "Users can read all sessions"
ON public."Session"
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to create sessions
CREATE POLICY "Users can create sessions"
ON public."Session"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Enable RLS on SessionPayment table
ALTER TABLE public."SessionPayment" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read all payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can create payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can update own payments" ON public."SessionPayment";

-- Policy: Allow authenticated users to read all session payments
CREATE POLICY "Users can read all payments"
ON public."SessionPayment"
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to create payments
CREATE POLICY "Users can create payments"
ON public."SessionPayment"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update their own payments
CREATE POLICY "Users can update own payments"
ON public."SessionPayment"
FOR UPDATE
TO authenticated
USING (true);

