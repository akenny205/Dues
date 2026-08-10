-- Converted from db/policies/add_dismissed_at_column.sql (kept there for history).
-- Tracks when a rejection was dismissed by the editor.

ALTER TABLE public."SessionEditApproval"
ADD COLUMN IF NOT EXISTS dismissed_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_session_edit_approval_dismissed
ON public."SessionEditApproval"(session_id, editor_user_id, dismissed_at)
WHERE dismissed_at IS NULL;
