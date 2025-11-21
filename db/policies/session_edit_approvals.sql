-- Table to track session edit approvals
-- Note: In Supabase, table names in the API use capital letters (e.g., 'Session', 'User')
-- but PostgreSQL stores them as lowercase. This SQL uses quoted identifiers to match
-- Supabase's case-sensitive table names. If you get errors, check your Supabase dashboard
-- for the exact table name format.

-- Try this version first (with quoted identifiers matching Supabase's case):
CREATE TABLE IF NOT EXISTS public."SessionEditApproval" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  session_id bigint NOT NULL,
  editor_user_id bigint NOT NULL,
  approver_user_id bigint NOT NULL,
  status text DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  old_amount numeric,
  new_amount numeric,
  CONSTRAINT "SessionEditApproval_pkey" PRIMARY KEY (id),
  CONSTRAINT "SessionEditApproval_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public."Session"(id),
  CONSTRAINT "SessionEditApproval_editor_user_id_fkey" FOREIGN KEY (editor_user_id) REFERENCES public."User"(id),
  CONSTRAINT "SessionEditApproval_approver_user_id_fkey" FOREIGN KEY (approver_user_id) REFERENCES public."User"(id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_session_edit_approval_session ON public."SessionEditApproval"(session_id);
CREATE INDEX IF NOT EXISTS idx_session_edit_approval_approver ON public."SessionEditApproval"(approver_user_id, status);
CREATE INDEX IF NOT EXISTS idx_session_edit_approval_editor ON public."SessionEditApproval"(editor_user_id, status);

-- Enable Row Level Security on SessionEditApproval table
ALTER TABLE public."SessionEditApproval" ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can read approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can create approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can update approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can delete approval records" ON public."SessionEditApproval";

-- Policy: Allow authenticated users to read approval records where they are the editor or approver
CREATE POLICY "Users can read approval records"
ON public."SessionEditApproval"
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to create approval records
-- Editors can create approval records for sessions they edit
CREATE POLICY "Users can create approval records"
ON public."SessionEditApproval"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update approval records
-- Approvers can update their own approval status (approve/reject)
-- Editors can update records for notifications
CREATE POLICY "Users can update approval records"
ON public."SessionEditApproval"
FOR UPDATE
TO authenticated
USING (true);

-- Policy: Allow authenticated users to delete approval records
-- Editors can delete approval records when cleaning up after rejection
CREATE POLICY "Users can delete approval records"
ON public."SessionEditApproval"
FOR DELETE
TO authenticated
USING (true);

