-- One-time cleanup to go with auto-approve becoming the default
-- (20261001000001): every session proposal still waiting on someone's
-- approval is approved and applied now, rather than sitting there until
-- each approver happens to click through.
--
-- This is the server-side equivalent of every outstanding approver clicking
-- Approve and the client then running finalizeSessionIfFullyApproved (see
-- src/app/groups/[id]/page.tsx) — same outcome per session:
--   • a deletion proposal    — the session is removed outright
--   • anything else          — each row's new_amount becomes that person's
--                              real SessionPayment (a ~$0 amount removes
--                              their row instead), then the approval rows
--                              are cleared
--   • a live-session close   — additionally drops the scratch line items /
--                              guests / delegations and flips is_live off
--
-- Only sessions with at least one 'pending' row are touched. A proposal
-- that was rejected or cancelled has no 'pending' rows left (see
-- handleRejectEdit / handleCancelEdit), so those are left exactly as-is.
DO $$
DECLARE
  target_session_id bigint;
  proposal_is_deletion boolean;
  proposal_is_live_close boolean;
  change record;
  applied_count integer := 0;
  deleted_count integer := 0;
BEGIN
  -- Both guards compare the row's approver/editor against auth.uid(), which
  -- is NULL in a migration — so approving or clearing a 'pending' row here
  -- would be refused as a forgery (20260811000011). They're switched off
  -- for the rest of this block only: ALTER TABLE holds a lock that blocks
  -- every other writer on the table until this commits, so no app request
  -- can ever run while they're disabled, and a failure anywhere below rolls
  -- the disable back along with everything else.
  ALTER TABLE public."SessionEditApproval" DISABLE TRIGGER trg_enforce_session_edit_approval_decision;
  ALTER TABLE public."SessionEditApproval" DISABLE TRIGGER trg_enforce_session_edit_approval_removal;

  FOR target_session_id IN
    SELECT DISTINCT a.session_id
    FROM public."SessionEditApproval" a
    WHERE a.status = 'pending'
    ORDER BY a.session_id
  LOOP
    -- The live proposal is the session's 'pending' + 'approved' rows; every
    -- row in one proposal carries the same is_deletion / is_live_close.
    SELECT COALESCE(bool_or(a.is_deletion), false), COALESCE(bool_or(a.is_live_close), false)
    INTO proposal_is_deletion, proposal_is_live_close
    FROM public."SessionEditApproval" a
    WHERE a.session_id = target_session_id
      AND a.status IN ('pending', 'approved');

    IF proposal_is_deletion THEN
      DELETE FROM public."SessionEditApproval" WHERE session_id = target_session_id;
      DELETE FROM public."SessionPayment" WHERE session_id = target_session_id;
      DELETE FROM public."LiveSessionEntry" WHERE session_id = target_session_id;
      DELETE FROM public."LiveSessionGuestDelegation" WHERE session_id = target_session_id;
      DELETE FROM public."LiveSessionGuest" WHERE session_id = target_session_id;
      DELETE FROM public."Session" WHERE id = target_session_id;
      deleted_count := deleted_count + 1;
      CONTINUE;
    END IF;

    -- Latest row per person, in case one somehow has more than one.
    FOR change IN
      SELECT DISTINCT ON (a.approver_user_id)
        a.approver_user_id AS user_id,
        COALESCE(a.new_amount, 0) AS amount
      FROM public."SessionEditApproval" a
      WHERE a.session_id = target_session_id
        AND a.status IN ('pending', 'approved')
      ORDER BY a.approver_user_id, a.id DESC
    LOOP
      IF abs(change.amount) < 0.01 THEN
        DELETE FROM public."SessionPayment"
        WHERE session_id = target_session_id AND user_id = change.user_id;
      ELSE
        UPDATE public."SessionPayment"
        SET amount = change.amount
        WHERE session_id = target_session_id AND user_id = change.user_id;

        IF NOT FOUND THEN
          INSERT INTO public."SessionPayment" (session_id, user_id, amount)
          VALUES (target_session_id, change.user_id, change.amount);
        END IF;
      END IF;
    END LOOP;

    DELETE FROM public."SessionEditApproval" WHERE session_id = target_session_id;

    IF proposal_is_live_close THEN
      DELETE FROM public."LiveSessionEntry" WHERE session_id = target_session_id;
      DELETE FROM public."LiveSessionGuestDelegation" WHERE session_id = target_session_id;
      DELETE FROM public."LiveSessionGuest" WHERE session_id = target_session_id;
      UPDATE public."Session" SET is_live = false WHERE id = target_session_id;
    END IF;

    applied_count := applied_count + 1;
  END LOOP;

  ALTER TABLE public."SessionEditApproval" ENABLE TRIGGER trg_enforce_session_edit_approval_decision;
  ALTER TABLE public."SessionEditApproval" ENABLE TRIGGER trg_enforce_session_edit_approval_removal;

  RAISE NOTICE 'Approved pending session proposals: % applied, % deleted', applied_count, deleted_count;
END;
$$;
