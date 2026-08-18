-- Backs the "who has/hasn't approved" breakdown on a pending session
-- proposal: it needs to tell a row that was pre-approved because the
-- approver opted into auto_approve_sessions (20260814000005) apart from one
-- they actually clicked Approve on. Neither the row's `status` nor anything
-- else on it currently carries that distinction.
ALTER TABLE public."SessionEditApproval"
  ADD COLUMN auto_approved boolean NOT NULL DEFAULT false;

-- create_session_edit_approvals (20260814000006) is the only place rows are
-- ever inserted pre-'approved' on someone else's behalf — recreate it to
-- also stamp auto_approved when that's *why* the row starts approved. The
-- editor's own row auto-approves too, but that's just "you always approve
-- your own change", unrelated to the preference, so it's left false there.
CREATE OR REPLACE FUNCTION public.create_session_edit_approvals(
  p_session_id bigint,
  p_rows jsonb -- array of {approver_user_id, old_amount, new_amount, is_deletion?, is_live_close?}
)
RETURNS TABLE (approver_user_id bigint, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id bigint;
  row_data jsonb;
  target_id bigint;
  target_pref text;
  computed_status text;
  computed_auto_approved boolean;
BEGIN
  SELECT u.id INTO caller_user_id FROM "User" u WHERE u.auth_user_id = auth.uid();
  IF caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_session_group_member(p_session_id) THEN
    RAISE EXCEPTION 'Not a member of this session''s group';
  END IF;

  FOR row_data IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    target_id := (row_data->>'approver_user_id')::bigint;
    computed_auto_approved := false;

    IF target_id = caller_user_id THEN
      -- You always auto-approve your own side of your own change —
      -- unrelated to anyone's auto_approve_sessions setting.
      computed_status := 'approved';
    ELSE
      SELECT u.auto_approve_sessions INTO target_pref FROM "User" u WHERE u.id = target_id;
      IF target_pref = 'all' THEN
        computed_status := 'approved';
        computed_auto_approved := true;
      ELSIF target_pref = 'live_only' AND COALESCE((row_data->>'is_live_close')::boolean, false) THEN
        computed_status := 'approved';
        computed_auto_approved := true;
      ELSE
        computed_status := 'pending';
      END IF;
    END IF;

    INSERT INTO "SessionEditApproval" (
      session_id, editor_user_id, approver_user_id, status,
      old_amount, new_amount, is_deletion, is_live_close, auto_approved
    ) VALUES (
      p_session_id,
      caller_user_id,
      target_id,
      computed_status,
      COALESCE((row_data->>'old_amount')::numeric, 0),
      COALESCE((row_data->>'new_amount')::numeric, 0),
      COALESCE((row_data->>'is_deletion')::boolean, false),
      COALESCE((row_data->>'is_live_close')::boolean, false),
      computed_auto_approved
    );

    approver_user_id := target_id;
    status := computed_status;
    RETURN NEXT;
  END LOOP;
END;
$$;
