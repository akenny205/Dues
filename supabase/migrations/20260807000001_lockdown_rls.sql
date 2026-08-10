-- Converted from db/policies/lockdown_rls.sql (kept there for history).
--
-- Locks down every policy that was previously USING (true) so that group data
-- (members, sessions, payments, approvals) is only ever readable/writable by
-- actual members of that group.
--
-- Two design decisions baked into this file:
--   1. Membership is checked via a real User.auth_user_id -> auth.users(id) link,
--      not by matching email strings.
--   2. "Join by pin" and "accept an invite" both need to read a Group/Invite row
--      *before* the caller is a member — those two lookups go through dedicated
--      SECURITY DEFINER functions that return only the minimal fields needed to
--      join, rather than opening up the whole table.
--
-- Permission model is otherwise unchanged from before: any member of a group can
-- read/create/edit/delete anything within it — there is no owner-only gating.

-- ============================================================================
-- 1. Link auth.users to the app's own User table
-- ============================================================================

ALTER TABLE public."User"
ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_user_id
ON public."User"(auth_user_id)
WHERE auth_user_id IS NOT NULL;

UPDATE public."User" u
SET auth_user_id = a.id
FROM auth.users a
WHERE u.auth_user_id IS NULL
  AND u.email = a.email;

-- ============================================================================
-- 2. Membership-check helpers (SECURITY DEFINER so they can read GroupMember/
--    Session themselves without recursing into the very policies they back)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_group_member(check_group_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "GroupMember" gm
    JOIN "User" u ON u.id = gm.user_id
    WHERE gm.id = check_group_id
      AND u.auth_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_session_group_member(check_session_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "Session" s
    WHERE s.id = check_session_id
      AND public.is_group_member(s.group_id)
  );
$$;

-- ============================================================================
-- 3. Bootstrap lookups — the two cases where you legitimately need to read
--    something before you're a member: joining by pin, and accepting an
--    invite. Both return only what's needed to join, nothing more (no pin
--    echoed back, no other group fields).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_group_by_pin(input_pin text)
RETURNS TABLE(id bigint, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.id, g.name
  FROM "Group" g
  WHERE g.pin = input_pin;
$$;

CREATE OR REPLACE FUNCTION public.find_invite_by_token(input_token text)
RETURNS TABLE(
  id bigint,
  group_id bigint,
  email text,
  expires_at timestamptz,
  accepted_at timestamptz,
  group_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT i.id, i.group_id, i.email, i.expires_at, i.accepted_at, g.name
  FROM "Invite" i
  LEFT JOIN "Group" g ON g.id = i.group_id
  WHERE i.token = input_token;
$$;

-- ============================================================================
-- 4. User — kept readable (usernames/emails/names aren't the sensitive data
--    here, and signup's uniqueness pre-check plus displaying group-mates'
--    names both need broad read access). Writes are scoped to your own row.
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert own profile" ON public."User";
DROP POLICY IF EXISTS "Users can read all profiles" ON public."User";
DROP POLICY IF EXISTS "Users can read own profile" ON public."User";
DROP POLICY IF EXISTS "Users can update own profile" ON public."User";

CREATE POLICY "Users can read all profiles"
ON public."User"
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can insert own profile"
ON public."User"
FOR INSERT
TO authenticated
WITH CHECK (
  email = (auth.jwt() ->> 'email')
  AND auth_user_id = auth.uid()
);

-- Covers both normal self-updates and the one-time "heal" of a legacy row
-- (auth_user_id still null, but the email matches your login) done by
-- getOrCreateUser the first time that account logs in post-migration.
CREATE POLICY "Users can update own profile"
ON public."User"
FOR UPDATE
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR (auth_user_id IS NULL AND email = (auth.jwt() ->> 'email'))
)
WITH CHECK (
  auth_user_id = auth.uid()
  OR (auth_user_id IS NULL AND email = (auth.jwt() ->> 'email'))
);

-- ============================================================================
-- 5. Group — members-only, plus the creator can see their own group in the
--    brief window between creating it and the follow-up GroupMember insert
--    that makes them an official member.
-- ============================================================================

DROP POLICY IF EXISTS "Users can read all groups" ON public."Group";
DROP POLICY IF EXISTS "Users can create groups" ON public."Group";
DROP POLICY IF EXISTS "Users can update own groups" ON public."Group";

CREATE POLICY "Members can read their groups"
ON public."Group"
FOR SELECT
TO authenticated
USING (
  public.is_group_member(id)
  OR created_by IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
);

CREATE POLICY "Users can create groups"
ON public."Group"
FOR INSERT
TO authenticated
WITH CHECK (
  created_by IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
);

CREATE POLICY "Members can update their groups"
ON public."Group"
FOR UPDATE
TO authenticated
USING (public.is_group_member(id))
WITH CHECK (public.is_group_member(id));

-- ============================================================================
-- 6. GroupMember — members-only reads. Anyone can add *themselves* to any
--    group (that's literally what joining is — via pin or invite, both of
--    which already gate on knowing a secret), but never add someone else.
-- ============================================================================

DROP POLICY IF EXISTS "Users can read group members" ON public."GroupMember";
DROP POLICY IF EXISTS "Users can create group members" ON public."GroupMember";
DROP POLICY IF EXISTS "Users can update group members" ON public."GroupMember";

CREATE POLICY "Members can read group membership"
ON public."GroupMember"
FOR SELECT
TO authenticated
USING (public.is_group_member(id));

CREATE POLICY "Users can add themselves to a group"
ON public."GroupMember"
FOR INSERT
TO authenticated
WITH CHECK (
  user_id IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
);

-- ============================================================================
-- 7. Session / SessionPayment / SessionEditApproval — members-only, full
--    read/write, matching the existing "any member can do anything" model.
-- ============================================================================

DROP POLICY IF EXISTS "Users can read all sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can create sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can update sessions" ON public."Session";
DROP POLICY IF EXISTS "Users can delete sessions" ON public."Session";

CREATE POLICY "Members can read sessions"
ON public."Session"
FOR SELECT
TO authenticated
USING (public.is_group_member(group_id));

CREATE POLICY "Members can create sessions"
ON public."Session"
FOR INSERT
TO authenticated
WITH CHECK (public.is_group_member(group_id));

CREATE POLICY "Members can update sessions"
ON public."Session"
FOR UPDATE
TO authenticated
USING (public.is_group_member(group_id))
WITH CHECK (public.is_group_member(group_id));

CREATE POLICY "Members can delete sessions"
ON public."Session"
FOR DELETE
TO authenticated
USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "Users can read all payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can create payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can update own payments" ON public."SessionPayment";
DROP POLICY IF EXISTS "Users can delete payments" ON public."SessionPayment";

CREATE POLICY "Members can read payments"
ON public."SessionPayment"
FOR SELECT
TO authenticated
USING (public.is_session_group_member(session_id));

CREATE POLICY "Members can create payments"
ON public."SessionPayment"
FOR INSERT
TO authenticated
WITH CHECK (public.is_session_group_member(session_id));

CREATE POLICY "Members can update payments"
ON public."SessionPayment"
FOR UPDATE
TO authenticated
USING (public.is_session_group_member(session_id))
WITH CHECK (public.is_session_group_member(session_id));

CREATE POLICY "Members can delete payments"
ON public."SessionPayment"
FOR DELETE
TO authenticated
USING (public.is_session_group_member(session_id));

DROP POLICY IF EXISTS "Users can read approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can create approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can update approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can delete approval records" ON public."SessionEditApproval";

CREATE POLICY "Members can read approval records"
ON public."SessionEditApproval"
FOR SELECT
TO authenticated
USING (public.is_session_group_member(session_id));

CREATE POLICY "Members can create approval records"
ON public."SessionEditApproval"
FOR INSERT
TO authenticated
WITH CHECK (public.is_session_group_member(session_id));

CREATE POLICY "Members can update approval records"
ON public."SessionEditApproval"
FOR UPDATE
TO authenticated
USING (public.is_session_group_member(session_id))
WITH CHECK (public.is_session_group_member(session_id));

CREATE POLICY "Members can delete approval records"
ON public."SessionEditApproval"
FOR DELETE
TO authenticated
USING (public.is_session_group_member(session_id));

-- ============================================================================
-- 8. Invite — members of the group can create/read/update invites for it.
--    The token-based lookup used by the accept-invite page goes through
--    find_invite_by_token() above instead, since that has to work before
--    the caller is a member.
-- ============================================================================

DROP POLICY IF EXISTS "Users can read invites" ON public."Invite";
DROP POLICY IF EXISTS "Users can create invites" ON public."Invite";
DROP POLICY IF EXISTS "Users can update invites" ON public."Invite";

CREATE POLICY "Members can read invites for their group"
ON public."Invite"
FOR SELECT
TO authenticated
USING (public.is_group_member(group_id));

CREATE POLICY "Members can create invites for their group"
ON public."Invite"
FOR INSERT
TO authenticated
WITH CHECK (public.is_group_member(group_id));

-- Covers accepting an invite (marking accepted_at) — by the time that update
-- runs, the GroupMember insert just before it has already gone through, so
-- the caller is already a member of the invite's group.
CREATE POLICY "Members can update invites for their group"
ON public."Invite"
FOR UPDATE
TO authenticated
USING (public.is_group_member(group_id))
WITH CHECK (public.is_group_member(group_id));
