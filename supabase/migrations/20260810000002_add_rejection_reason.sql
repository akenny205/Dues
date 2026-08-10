-- Requires the approver to explain why they're rejecting an edit, deletion, or
-- payment proposal — the reason is shown to the editor on the rejection notice
-- (see handleRejectEdit in src/app/groups/[id]/page.tsx).
ALTER TABLE public."SessionEditApproval"
ADD COLUMN IF NOT EXISTS rejection_reason text;
