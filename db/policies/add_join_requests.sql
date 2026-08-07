-- Group owners must approve people before they actually become members.
-- Joining by pin (see src/app/page.tsx handleJoinGroup) now creates a
-- JoinRequest row instead of inserting straight into GroupMember; the owner
-- approves or rejects it from the group's Members tab. Run this in the
-- Supabase SQL Editor.
--
-- This does NOT change the "no permission gating" decision (any member can
-- still do anything within a group they're in) — it adds exactly one
-- owner-only action: deciding who gets in in the first place.
--
-- Defensively repeats the auth_user_id setup from lockdown_rls.sql so this
-- file works regardless of which migration you ran first.

ALTER TABLE public."User"
ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_user_id
ON public."User"(auth_user_id)
WHERE auth_user_id IS NOT NULL;

-- ============================================================================
-- 1. JoinRequest table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."JoinRequest" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  group_id bigint NOT NULL,
  user_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  CONSTRAINT "JoinRequest_pkey" PRIMARY KEY (id),
  CONSTRAINT "JoinRequest_group_id_fkey" FOREIGN KEY (group_id) REFERENCES public."Group"(id),
  CONSTRAINT "JoinRequest_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id)
);

CREATE INDEX IF NOT EXISTS idx_join_request_group_status
ON public."JoinRequest"(group_id, status);

CREATE INDEX IF NOT EXISTS idx_join_request_user
ON public."JoinRequest"(user_id);

-- ============================================================================
-- 2. Owner-check helper (mirrors is_group_member from lockdown_rls.sql, but
--    additionally requires role = 'owner')
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_group_owner(check_group_id bigint)
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
      AND gm.role = 'owner'
  );
$$;

-- ============================================================================
-- 3. Approve / reject — both run as the table owner (SECURITY DEFINER) so
--    they can insert a GroupMember row for someone *else*, which the normal
--    "you can only add yourself" GroupMember policy deliberately disallows.
--    Each one re-checks ownership itself, so it's safe to call regardless of
--    what RLS would otherwise permit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_join_request(request_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM "JoinRequest" WHERE id = request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found or already resolved';
  END IF;

  IF NOT public.is_group_owner(req.group_id) THEN
    RAISE EXCEPTION 'Only the group owner can approve join requests';
  END IF;

  INSERT INTO "GroupMember" (id, user_id, role)
  VALUES (req.group_id, req.user_id, 'member')
  ON CONFLICT (id, user_id) DO NOTHING;

  DELETE FROM "JoinRequest" WHERE id = request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_join_request(request_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM "JoinRequest" WHERE id = request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found or already resolved';
  END IF;

  IF NOT public.is_group_owner(req.group_id) THEN
    RAISE EXCEPTION 'Only the group owner can reject join requests';
  END IF;

  DELETE FROM "JoinRequest" WHERE id = request_id;
END;
$$;

-- ============================================================================
-- 4. RLS — the owner sees every request for their group; anyone can see
--    (and create, and cancel) their own. Only approve/reject_join_request()
--    can actually resolve one, so a plain UPDATE policy isn't needed.
-- ============================================================================

ALTER TABLE public."JoinRequest" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner and requester can read join requests" ON public."JoinRequest";
DROP POLICY IF EXISTS "Users can request to join" ON public."JoinRequest";
DROP POLICY IF EXISTS "Owner or requester can cancel a join request" ON public."JoinRequest";

CREATE POLICY "Owner and requester can read join requests"
ON public."JoinRequest"
FOR SELECT
TO authenticated
USING (
  public.is_group_owner(group_id)
  OR user_id IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
);

CREATE POLICY "Users can request to join"
ON public."JoinRequest"
FOR INSERT
TO authenticated
WITH CHECK (
  user_id IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
);

CREATE POLICY "Owner or requester can cancel a join request"
ON public."JoinRequest"
FOR DELETE
TO authenticated
USING (
  public.is_group_owner(group_id)
  OR user_id IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
);
