-- Invite table for group invitations
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public."Invite" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  group_id bigint NOT NULL,
  email character varying NOT NULL,
  token character varying NOT NULL UNIQUE,
  expires_at timestamp with time zone,
  accepted_at timestamp with time zone,
  invited_by bigint,
  CONSTRAINT Invite_pkey PRIMARY KEY (id),
  CONSTRAINT Invite_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."Group"(id),
  CONSTRAINT Invite_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public."User"(id)
);

-- Enable RLS on Invite table
ALTER TABLE public."Invite" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read invites" ON public."Invite";
DROP POLICY IF EXISTS "Users can create invites" ON public."Invite";
DROP POLICY IF EXISTS "Users can update invites" ON public."Invite";

-- Policy: Allow authenticated users to read invites (for their email or groups they own)
CREATE POLICY "Users can read invites"
ON public."Invite"
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to create invites
CREATE POLICY "Users can create invites"
ON public."Invite"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update invites (to mark as accepted)
CREATE POLICY "Users can update invites"
ON public."Invite"
FOR UPDATE
TO authenticated
USING (true);

-- Add RLS policies for GroupMember if not already added
ALTER TABLE public."GroupMember" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read group members" ON public."GroupMember";
DROP POLICY IF EXISTS "Users can create group members" ON public."GroupMember";
DROP POLICY IF EXISTS "Users can update group members" ON public."GroupMember";

CREATE POLICY "Users can read group members"
ON public."GroupMember"
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create group members"
ON public."GroupMember"
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can update group members"
ON public."GroupMember"
FOR UPDATE
TO authenticated
USING (true);

