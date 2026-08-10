-- Converted from db/policies/session_edit_approvals.sql (kept there for history).
-- Table to track session edit approvals.

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

CREATE INDEX IF NOT EXISTS idx_session_edit_approval_session ON public."SessionEditApproval"(session_id);
CREATE INDEX IF NOT EXISTS idx_session_edit_approval_approver ON public."SessionEditApproval"(approver_user_id, status);
CREATE INDEX IF NOT EXISTS idx_session_edit_approval_editor ON public."SessionEditApproval"(editor_user_id, status);

ALTER TABLE public."SessionEditApproval" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can create approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can update approval records" ON public."SessionEditApproval";
DROP POLICY IF EXISTS "Users can delete approval records" ON public."SessionEditApproval";

CREATE POLICY "Users can read approval records"
ON public."SessionEditApproval"
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create approval records"
ON public."SessionEditApproval"
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can update approval records"
ON public."SessionEditApproval"
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Users can delete approval records"
ON public."SessionEditApproval"
FOR DELETE
TO authenticated
USING (true);
