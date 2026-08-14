-- Auto-approve (20260814000005) needs a session's editor to be able to
-- insert an already-'approved' SessionEditApproval row for someone *else*
-- — but "Members can create approval records" (20260811000011) deliberately
-- blocks exactly that, to stop anyone from fabricating another member's
-- approval:
--
--   WITH CHECK (
--     is_session_group_member(session_id)
--     AND (status = 'pending' OR approver_user_id = caller)
--   )
--
-- A target member's own auto_approve_sessions preference is a legitimate,
-- self-granted exception to that rule — they opted into it themselves, in
-- their own profile — but the client can't be trusted to just *claim* that
-- exception applies (that's the same forgery the policy above exists to
-- stop). So this wraps the whole batch insert in a SECURITY DEFINER
-- function that looks up each target's actual stored preference itself and
-- computes their row's status from it server-side, rather than trusting
-- whatever status the caller sends. The RLS policy above is untouched and
-- still blocks a raw client-side insert of a fabricated 'approved' row —
-- this function is simply also a legitimate way to create these rows now,
-- same as the trigger-guarded UPDATE path already is for actually clicking
-- Approve.
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

    IF target_id = caller_user_id THEN
      -- You always auto-approve your own side of your own change —
      -- unrelated to anyone's auto_approve_sessions setting.
      computed_status := 'approved';
    ELSE
      SELECT u.auto_approve_sessions INTO target_pref FROM "User" u WHERE u.id = target_id;
      IF target_pref = 'all' THEN
        computed_status := 'approved';
      ELSIF target_pref = 'live_only' AND COALESCE((row_data->>'is_live_close')::boolean, false) THEN
        computed_status := 'approved';
      ELSE
        computed_status := 'pending';
      END IF;
    END IF;

    INSERT INTO "SessionEditApproval" (
      session_id, editor_user_id, approver_user_id, status,
      old_amount, new_amount, is_deletion, is_live_close
    ) VALUES (
      p_session_id,
      caller_user_id,
      target_id,
      computed_status,
      COALESCE((row_data->>'old_amount')::numeric, 0),
      COALESCE((row_data->>'new_amount')::numeric, 0),
      COALESCE((row_data->>'is_deletion')::boolean, false),
      COALESCE((row_data->>'is_live_close')::boolean, false)
    );

    approver_user_id := target_id;
    status := computed_status;
    RETURN NEXT;
  END LOOP;
END;
$$;
