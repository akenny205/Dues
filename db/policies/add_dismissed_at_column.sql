-- Add dismissed_at column to SessionEditApproval table
-- This allows us to track when a rejection was dismissed by the editor

ALTER TABLE public."SessionEditApproval"
ADD COLUMN IF NOT EXISTS dismissed_at timestamp with time zone;

-- Create index for faster queries filtering dismissed rejections
CREATE INDEX IF NOT EXISTS idx_session_edit_approval_dismissed 
ON public."SessionEditApproval"(session_id, editor_user_id, dismissed_at)
WHERE dismissed_at IS NULL;

