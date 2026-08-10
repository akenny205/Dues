-- Converted from db/policies/rls_policies.sql (kept there for history).
-- Initial, permissive RLS: every table open to any authenticated user.
-- Locked down for real in 20260807000001_lockdown_rls.sql.

-- Enable RLS on User table (if not already enabled)
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own profile" ON public."User";
DROP POLICY IF EXISTS "Users can read all profiles" ON public."User";
DROP POLICY IF EXISTS "Users can read own profile" ON public."User";

CREATE POLICY "Users can insert own profile"
ON public."User"
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can read all profiles"
ON public."User"
FOR SELECT
TO authenticated
USING (true);

-- Enable RLS on Group table
ALTER TABLE public."Group" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read all groups" ON public."Group";
DROP POLICY IF EXISTS "Users can create groups" ON public."Group";
DROP POLICY IF EXISTS "Users can update own groups" ON public."Group";

CREATE POLICY "Users can read all groups"
ON public."Group"
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create groups"
ON public."Group"
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can update own groups"
ON public."Group"
FOR UPDATE
TO authenticated
USING (true);

-- Enable RLS on Session table
ALTER TABLE public."Session" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read all sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can create sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can update sessions" ON public."Session";

CREATE POLICY "Users can read all sessions"
ON public."Session"
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create sessions"
ON public."Session"
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can update sessions"
ON public."Session"
FOR UPDATE
TO authenticated
USING (true);

-- Enable RLS on SessionPayment table
ALTER TABLE public."SessionPayment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read all payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can create payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can update own payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can delete payments" ON public."SessionPayment";

CREATE POLICY "Users can read all payments"
ON public."SessionPayment"
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create payments"
ON public."SessionPayment"
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can update own payments"
ON public."SessionPayment"
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Users can delete payments"
ON public."SessionPayment"
FOR DELETE
TO authenticated
USING (true);
