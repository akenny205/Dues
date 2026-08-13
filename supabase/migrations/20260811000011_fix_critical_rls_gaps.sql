-- Closes three critical authorization gaps found in a pre-production
-- security pass, all present since 20260807000001_lockdown_rls.sql and
-- never actually narrowed by any later migration that assumed they were:
--
-- 1. GroupMember's INSERT policy only checked that user_id was your own row
--    — it never constrained *which group* (id) or *what role*. Any signed-up
--    user could self-insert into ANY group with role='owner' just by
--    guessing its (sequential, small) id, which then satisfies
--    is_group_owner() and unlocks every owner-only RPC (delete_group,
--    transfer_group_ownership, remove_group_member, regenerate_group_pin,
--    update_group_banner, ...). This is the root cause behind nearly every
--    "owner-only" feature actually being bypassable.
--
-- 2. Group's UPDATE policy was member-wide with no column restriction, so
--    even without forging role='owner', simply being *any* member of a
--    group let you write straight to its pin/pin_enabled/deleted_at/
--    banner_url/name columns, bypassing every owner-only settings RPC that
--    was supposed to gate those.
--
-- 3. SessionEditApproval had no protection against forging someone else's
--    approve/reject decision, or fabricating an already-"approved" row
--    from scratch with someone else's amount attached to their name — both
--    of which defeat the entire point of that table (nobody can clear a
--    debt by just claiming it's settled).
--
-- None of the app's legitimate flows change: group creation, join-by-pin +
-- owner approval, session edits/payments/settle-up, and every existing
-- owner-only RPC all keep working exactly as before — this only removes
-- paths that were never exercised by the app itself, just reachable by
-- anyone willing to call supabase-js or curl directly.

-- ============================================================================
-- 1. GroupMember — the only direct (non-RPC) insert the app ever does is a
--    group's creator seating themselves as its first owner, immediately
--    after creating it (see src/app/page.tsx handleCreateGroup). Every other
--    way of becoming a member — join-by-pin (approve_join_request) —
--    already goes through a SECURITY DEFINER function, which bypasses RLS
--    entirely and is unaffected by this.
--
--    (The invite-accept flow, src/app/invite/[token]/page.tsx, also does a
--    direct insert as role='member' — that path is left broken by this
--    change, same as it already was in practice: nothing in the app creates
--    an Invite row today, so it was already unreachable. If that feature
--    gets wired up, it'll need its own SECURITY DEFINER RPC, same pattern
--    as approve_join_request, rather than a raw insert.)
-- ============================================================================

DROP POLICY IF EXISTS "Users can add themselves to a group" ON public."GroupMember";

CREATE POLICY "Creator can seat themselves as owner of their new group"
ON public."GroupMember"
FOR INSERT
TO authenticated
WITH CHECK (
  role = 'owner'
  AND user_id IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
  AND id IN (SELECT g.id FROM "Group" g WHERE g.created_by = user_id)
);

-- ============================================================================
-- 2. Group — no code path in the app ever does a direct
--    supabase.from('Group').update(...); every real settings change already
--    goes through a SECURITY DEFINER RPC (update_group_details,
--    regenerate_group_pin, set_group_pin_enabled, delete_group,
--    restore_group, update_group_banner, transfer_group_ownership), all of
--    which bypass RLS and are unaffected by dropping this. There is
--    therefore no legitimate reason for a plain UPDATE policy to exist here
--    at all.
-- ============================================================================

DROP POLICY IF EXISTS "Members can update their groups" ON public."Group";

-- ============================================================================
-- 3. SessionEditApproval — tightened three ways:
--
--    a) INSERT: previously any group member could insert a row in *any*
--       status with *any* approver_user_id — including a fabricated
--       'approved' row claiming someone else already approved an amount
--       they never saw. Every legitimate insert in the app either creates a
--       'pending' row (asking someone else to review) or an already-decided
--       row about *the caller's own* approval (the auto-approved "editor
--       approves their own change" rows, and the rejection-notice row
--       handleRejectEdit creates for the editor) — so a row that isn't
--       'pending' is only ever legitimate when approver_user_id is the
--       caller themselves.
--
--    b) UPDATE: previously any group member could flip a 'pending' row on
--       another approver's plate straight to 'approved'/'rejected',
--       forcing through a change that person never agreed to. A trigger
--       (rather than a WITH CHECK) is used here because this needs to
--       compare the *old* status against the *new* one — RLS policies only
--       ever see one side of an UPDATE at a time. Every other transition
--       used by the app (marking other rows 'rejected_notice'/'cancelled',
--       setting dismissed_at) is left untouched, since none of those forge
--       anyone's actual decision.
--
--    c) DELETE: previously any group member could delete another
--       approver's still-'pending' row outright, which — since
--       handleApproveEdit finalizes a session the moment zero 'pending'
--       rows remain — let an attacker manufacture a false "everyone
--       decided" state by simply deleting everyone else's undecided votes.
--       Deleting a row that's already been decided (approved/rejected/etc)
--       is unaffected — that's the normal post-consensus cleanup every
--       approval flow ends with.
-- ============================================================================

DROP POLICY IF EXISTS "Members can create approval records" ON public."SessionEditApproval";

CREATE POLICY "Members can create approval records"
ON public."SessionEditApproval"
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_session_group_member(session_id)
  AND (
    status = 'pending'
    OR approver_user_id IN (SELECT id FROM "User" WHERE auth_user_id = auth.uid())
  )
);

CREATE OR REPLACE FUNCTION public.enforce_session_edit_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id bigint;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    SELECT u.id INTO caller_user_id FROM "User" u WHERE u.auth_user_id = auth.uid();
    IF caller_user_id IS DISTINCT FROM OLD.approver_user_id THEN
      RAISE EXCEPTION 'Only the assigned approver can approve or reject this';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_session_edit_approval_decision ON public."SessionEditApproval";
CREATE TRIGGER trg_enforce_session_edit_approval_decision
BEFORE UPDATE ON public."SessionEditApproval"
FOR EACH ROW
EXECUTE FUNCTION public.enforce_session_edit_approval_decision();

CREATE OR REPLACE FUNCTION public.enforce_session_edit_approval_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_user_id bigint;
BEGIN
  IF OLD.status = 'pending' THEN
    SELECT u.id INTO caller_user_id FROM "User" u WHERE u.auth_user_id = auth.uid();
    IF caller_user_id IS DISTINCT FROM OLD.approver_user_id
       AND caller_user_id IS DISTINCT FROM OLD.editor_user_id THEN
      RAISE EXCEPTION 'Only the approver or the editor can remove a pending approval';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_session_edit_approval_removal ON public."SessionEditApproval";
CREATE TRIGGER trg_enforce_session_edit_approval_removal
BEFORE DELETE ON public."SessionEditApproval"
FOR EACH ROW
EXECUTE FUNCTION public.enforce_session_edit_approval_removal();
