'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Camera,
  Check,
  ClipboardList,
  Hourglass,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
  XCircle,
} from 'lucide-react'
import Skeleton from '@/components/Skeleton'
import ToastStack from '@/components/ToastStack'
import ProfileModal from '@/components/ProfileModal'
import AuthPanel from '@/components/AuthPanel'
import Avatar from '@/components/Avatar'
import InfoTooltip from '@/components/InfoTooltip'
import PaymentMethodIcon, { PaymentMethodBadge } from '@/components/PaymentMethodIcon'
import useAuth from '@/hooks/useAuth'
import useToast from '@/hooks/useToast'
import useAsyncGuard from '@/hooks/useAsyncGuard'
import { supabase } from '@/lib/supabase'
import { getOrCreateUser } from '@/lib/userHelper'
import BannerCropModal from '@/components/BannerCropModal'
import { PAYMENT_METHOD_OPTIONS, paymentMethodLabel } from '@/lib/paymentLinks'

interface Group {
  id: number
  name: string | null
  created_at: string
  created_by: number | null
  pin?: string | null
  description?: string | null
  pin_enabled?: boolean
  deleted_at?: string | null
  banner_url?: string | null
}

interface Session {
  id: number
  Description: string | null
  group_id: number | null
  created_at: string
  created_by?: number | null
  notes?: string | null
  is_live?: boolean | null
  is_payment?: boolean | null
  payment_method?: string | null
  memberCount?: number
  totalAmount?: number
  userPayment?: number | null
  pendingApproval?: boolean
  pendingRejection?: boolean
  waitingForApproval?: boolean // Editor is waiting for others to approve
  pendingIsDeletion?: boolean // The in-flight approval (either direction above) is a deletion request, not an amount edit
  rejectedByMeAsProposal?: boolean // I rejected this and it never had any real SessionPayment rows (a brand-new payment/session proposal) — hide it from my list entirely rather than showing an empty shell
}

interface Due {
  id: number
  session_id: number
  user_id: number
  amount: number
  Description: string | null
  paid: boolean
  created_at: string
  user_email?: string
}

interface GroupMember {
  id: number
  user_id: number
  role: string | null
  created_at: string
  status?: string | null
  email?: string
  username?: string
  first_name?: string
  last_name?: string
  avatar_url?: string | null
}

// Blocks the Up/Down arrow keys on a number input. The CSS that hides the
// spinner buttons (`.no-spinner`) doesn't stop the browser from still
// stepping the value by 1 cent on arrow-key presses — this is the other
// half of that, for amount fields where nudging by a cent isn't a real
// workflow.
const blockNumberArrowKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
  }
}

// Blocks the trackpad/mouse-wheel from stepping a focused number input by a
// cent. React's wheel listener is passive, so calling preventDefault() here
// wouldn't actually stop the browser's default behavior (and would just log
// a warning) — blurring the input the moment a wheel event starts over it is
// what actually prevents the value from changing, while leaving page scroll
// completely unaffected.
const blockNumberScroll = (e: React.WheelEvent<HTMLInputElement>) => {
  e.currentTarget.blur()
}

// Helper function to format names: "First L." with last initial only if duplicate
// first names — and "First Last" (full last name) if the last initial alone
// still wouldn't tell them apart (e.g. "Andrew Kenn" vs. "Andrew Kenny").
const formatDisplayName = (members: GroupMember[], currentMember: GroupMember): string => {
  const firstName = currentMember.first_name || currentMember.username || 'Unknown'
  const lastName = currentMember.last_name || ''

  // Capitalize first letter of first name
  const capitalizedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()

  // Everyone else in the group sharing this first name (case-insensitive).
  // Empty/singleton means the first name is unique — no disambiguation needed.
  const sameFirstName = members.filter(m => {
    const otherFirstName = (m.first_name || m.username || '').toLowerCase()
    return otherFirstName === firstName.toLowerCase()
  })

  if (sameFirstName.length <= 1 || !lastName) {
    return capitalizedFirstName
  }

  // A last initial only disambiguates if nobody else sharing this first name
  // also shares that initial — otherwise fall back to the full last name so
  // they don't still collide.
  const lastInitial = lastName.charAt(0).toUpperCase()
  const initialAlsoCollides = sameFirstName.some(m => {
    if (m.user_id === currentMember.user_id) return false
    const otherLastInitial = (m.last_name || '').charAt(0).toUpperCase()
    return otherLastInitial === lastInitial
  })

  if (initialAlsoCollides) {
    const capitalizedLastName = lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase()
    return `${capitalizedFirstName} ${capitalizedLastName}`
  }

  return `${capitalizedFirstName} ${lastInitial}.`
}

// Turns a set of net balances into the smallest possible set of payments that
// zero everyone out, instead of the naive "everyone settles with the group"
// approach (which is exactly as many transactions as there are non-zero
// balances). Standard greedy cash-flow minimization: at each step, match
// whoever owes the most against whoever is owed the most, so every match
// fully clears at least one side. Not provably minimal in every edge case
// (that's NP-hard in general), but it's the same heuristic Splitwise-style
// apps use and it's minimal in practice.
const computeSettlementPlan = (
  balances: { user_id: number; balance: number }[]
): { from: number; to: number; amount: number }[] => {
  const creditors = balances
    .filter(b => Math.round(b.balance) >= 1)
    .map(b => ({ user_id: b.user_id, amount: Math.round(b.balance) }))
    .sort((a, b) => b.amount - a.amount)
  const debtors = balances
    .filter(b => Math.round(b.balance) <= -1)
    .map(b => ({ user_id: b.user_id, amount: -Math.round(b.balance) }))
    .sort((a, b) => b.amount - a.amount)

  const plan: { from: number; to: number; amount: number }[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const amount = Math.min(debtor.amount, creditor.amount)
    plan.push({ from: debtor.user_id, to: creditor.user_id, amount })
    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount === 0) i++
    if (creditor.amount === 0) j++
  }
  return plan
}

// A "make a payment" or "settle up" action creates a brand-new Session that's
// pending approval — it isn't an edit to an existing one, even though both
// flows reuse the same SessionEditApproval machinery under the hood (see
// handleSettleUp/handleMakePayment). This tells the two apart from a real
// edit so the UI stops calling withdrawing a payment "cancelling an edit".
// Settle-ups are identified by their fixed Description (set once, in
// handleSettleUp, and never user-editable while pending) since there's no
// dedicated flag for them.
type PendingSessionKind = 'deletion' | 'settleUp' | 'payment' | 'edit'

// Both the whole-group plan (handleSettleUp) and the single-member version
// scoped to just your own balance (handleSettleBalance) write one of these
// two fixed Descriptions, never user-editable while pending — this is how
// the two are told apart from a real edit/payment everywhere else below.
const isSettleUpDescription = (description?: string | null): boolean =>
  description === 'Group settle up' || description === 'Settle up'

const pendingSessionKind = (session: {
  pendingIsDeletion?: boolean
  is_payment?: boolean | null
  Description?: string | null
}): PendingSessionKind => {
  if (session.pendingIsDeletion) return 'deletion'
  if (isSettleUpDescription(session.Description)) return 'settleUp'
  if (session.is_payment) return 'payment'
  return 'edit'
}

const cancelActionLabel = (kind: PendingSessionKind): string => {
  switch (kind) {
    case 'deletion': return 'Cancel deletion request'
    case 'settleUp': return 'Cancel settle up'
    case 'payment': return 'Cancel payment'
    default: return 'Cancel edit'
  }
}

const cancelActionCopy = (kind: PendingSessionKind): { title: string; body: string } => {
  switch (kind) {
    case 'deletion':
      return {
        title: 'Cancel this deletion request?',
        body: 'The session will stay exactly as it is. Anyone who already approved or rejected the deletion will be notified that the request was cancelled.',
      }
    case 'settleUp':
      return {
        title: 'Cancel this settle up?',
        body: "It'll be withdrawn and no balances will change. Anyone who already confirmed it will be notified that it was cancelled.",
      }
    case 'payment':
      return {
        title: 'Cancel this payment?',
        body: "It'll be withdrawn and no balances will change. Anyone who already confirmed it will be notified that it was cancelled.",
      }
    default:
      return {
        title: 'Cancel this edit?',
        body: 'The session will keep its current amounts. Anyone who already approved or rejected your changes will be notified that the edit was cancelled.',
      }
  }
}

export default function GroupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const groupId = parseInt(params.id as string)
  const { user, loading: authLoading } = useAuth()
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [dues, setDues] = useState<Due[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<number | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [pendingJoinRequests, setPendingJoinRequests] = useState<Array<{ id: number; user_id: number; displayName: string; username: string; avatar_url: string | null; created_at: string }>>([])
  const [showPin, setShowPin] = useState(false)
  const [activeTab, setActiveTab] = useState<'dues' | 'members' | 'sessions' | 'info'>('dues')
  const [showMakePaymentModal, setShowMakePaymentModal] = useState(false)
  const [paymentPayee, setPaymentPayee] = useState<number | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDescription, setPaymentDescription] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  const [showSettleUpModal, setShowSettleUpModal] = useState(false)
  const [isSubmittingSettleUp, setIsSubmittingSettleUp] = useState(false)
  // Editable who-pays-who breakdown for the settle up modal — seeded from the
  // auto-computed minimal plan but freely reassignable, so members can match
  // however they actually intend to pay instead of the fewest-transactions
  // default. `id` is a stable React key independent of from/to/amount so
  // rows don't get remounted (and lose focus) as they're edited.
  const [settleUpLegs, setSettleUpLegs] = useState<{ id: number; from: number | null; to: number | null; amount: string }[]>([])
  const settleUpLegIdRef = useRef(0)
  const [showSettleBalanceModal, setShowSettleBalanceModal] = useState(false)
  const [isSubmittingSettleBalance, setIsSubmittingSettleBalance] = useState(false)
  // Scoped-down sibling of settleUpLegs: every row pays or receives against
  // "you" specifically (direction is fixed by the sign of your own balance,
  // see settleBalanceDirection), so each leg only needs a counterparty and an
  // amount rather than a full from/to pair.
  const [settleBalanceLegs, setSettleBalanceLegs] = useState<{ id: number; counterpartyId: number | null; amount: string }[]>([])
  const settleBalanceLegIdRef = useRef(0)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showAddSession, setShowAddSession] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null)
  const [viewingSessionId, setViewingSessionId] = useState<number | null>(null)
  const [sessionDescription, setSessionDescription] = useState('')
  const [sessionMembers, setSessionMembers] = useState<Array<{ user_id: number; email: string; username: string; first_name?: string; last_name?: string; amount: string }>>([])
  const [showMemberDropdown, setShowMemberDropdown] = useState(false)
  const [splitTotalAmount, setSplitTotalAmount] = useState('')
  const [splitPayerId, setSplitPayerId] = useState<number | null>(null)
  const [sessionDetails, setSessionDetails] = useState<Array<{ user_id: number; email: string; username: string; first_name?: string; last_name?: string; amount: number }>>([])
  const [selectedLiveSession, setSelectedLiveSession] = useState<number | null>(null)
  const [liveSessionAmount, setLiveSessionAmount] = useState('')
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: number; session_id: number; editor_user_id: number; old_amount: number; new_amount: number; session_description: string; is_deletion?: boolean }>>([])
  const [pendingRejections, setPendingRejections] = useState<Array<{ id: number; session_id: number; approver_user_id: number; session_description: string; approver_name?: string; approver_email?: string; rejected_at?: string; is_deletion?: boolean; rejection_reason?: string | null }>>([])
  const [pendingCancellations, setPendingCancellations] = useState<Array<{ id: number; session_id: number; session_description: string; old_amount: number; new_amount: number; is_deletion?: boolean }>>([])
  const [pendingRejectionNotices, setPendingRejectionNotices] = useState<Array<{ id: number; session_id: number; session_description: string; rejected_by_name?: string; is_deletion?: boolean }>>([])
  const [originalPayments, setOriginalPayments] = useState<Array<{ user_id: number; amount: number }>>([])
  const [allSessionApprovals, setAllSessionApprovals] = useState<Array<{ user_id: number; old_amount: number; new_amount: number }>>([])
  const [editorUserId, setEditorUserId] = useState<number | null>(null)
  const [confirmCancelSessionId, setConfirmCancelSessionId] = useState<number | null>(null)
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<number | null>(null)
  const [confirmCancelEditSessionId, setConfirmCancelEditSessionId] = useState<number | null>(null)
  const [rejectingApproval, setRejectingApproval] = useState<{ approvalId: number; sessionId: number; editorUserId: number; isDeletion?: boolean } | null>(null)
  const [rejectReasonDraft, setRejectReasonDraft] = useState('')
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<number | null>(null)
  const [confirmLeaveGroup, setConfirmLeaveGroup] = useState(false)
  const [leavingGroup, setLeavingGroup] = useState(false)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState('')
  const [savingGroupDetails, setSavingGroupDetails] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [bannerError, setBannerError] = useState('')
  const [confirmRemoveBanner, setConfirmRemoveBanner] = useState(false)
  const [pendingBannerFile, setPendingBannerFile] = useState<File | null>(null)
  // Staged photo (data URL) or color (hex) waiting on the approve popup —
  // nothing here is saved until handleApproveBanner runs.
  const [pendingBannerValue, setPendingBannerValue] = useState<string | null>(null)
  const [pinActionLoading, setPinActionLoading] = useState(false)
  const [showDeleteGroupConfirm, setShowDeleteGroupConfirm] = useState(false)
  const [showDeleteBalanceWarning, setShowDeleteBalanceWarning] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState(false)
  const [transferTargetUserId, setTransferTargetUserId] = useState<number | null>(null)
  const [showTransferConfirm, setShowTransferConfirm] = useState(false)
  const [transferringOwnership, setTransferringOwnership] = useState(false)
  const [editingNotesSessionId, setEditingNotesSessionId] = useState<number | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [showCreateLiveSessionModal, setShowCreateLiveSessionModal] = useState(false)
  const [liveSessionDescription, setLiveSessionDescription] = useState('')
  const [profileModalUserId, setProfileModalUserId] = useState<number | null>(null)
  const [profileModalContext, setProfileModalContext] = useState<{ amount?: number; note?: string }>({})
  const { toasts, showToast, dismiss } = useToast()
  // Blocks a second click on the same button (or a fast double Enter-key
  // submit) from firing a network call twice while the first is still in
  // flight — see useAsyncGuard for how the per-action `key`s are scoped.
  const { isBusy, guard } = useAsyncGuard()

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
      return
    }

    if (user && groupId && !isNaN(groupId)) {
      // Get or create user in User table
      getOrCreateUser(user).then((dbUserId) => {
        if (dbUserId) {
          setUserId(dbUserId)
        } else {
          console.error('Failed to get or create user')
          setLoading(false)
        }
      })
    }
  }, [user, authLoading, router, groupId])

  const loadGroup = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('Group')
        .select('*')
        .eq('id', groupId)
        .single()

      if (error) {
        console.error('Error loading group:', error)
        throw error
      }
      
      if (data) {
        // A deleted group is a soft flag, not an absence — the row (and its
        // history) is still right there in the DB, and the owner can bring
        // it back from the "Archived Groups" list on their account Settings
        // page (src/app/profile/page.tsx). But this page itself still
        // treats it as gone, so anyone landing here gets bounced the same
        // way they would for a group that never existed.
        if (data.deleted_at) {
          showToast('This group has been deleted.')
          router.push('/')
          return
        }

        setGroup({
          id: data.id,
          name: data.name,
          created_at: data.created_at,
          created_by: data.created_by,
          pin: data.pin,
          description: data.description ?? null,
          pin_enabled: data.pin_enabled !== false,
          deleted_at: data.deleted_at ?? null,
          banner_url: data.banner_url ?? null
        })
      }
    } catch (error) {
      console.error('Error loading group:', error)
      showToast('Group not found')
      router.push('/')
    }
  }, [groupId, router])

  const loadDues = useCallback(async () => {
    try {
      // First, get all sessions for this group
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('Session')
        .select('id')
        .eq('group_id', groupId)

      if (sessionsError) throw sessionsError

      const sessionIds = (sessionsData || []).map((s: any) => s.id)
      
      if (sessionIds.length === 0) {
        setDues([])
        setLoading(false)
        return
      }

      // Then get all payments for those sessions
      const { data: duesData, error } = await supabase
        .from('SessionPayment')
        .select('*')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false })

      if (error) throw error
      
      // Fetch user emails from User table
      const userIds = [...new Set((duesData || []).map((d: any) => d.user_id))]
      const emailMap: Record<number, string> = {}
      
      if (userIds.length > 0) {
        try {
          const { data: usersData } = await supabase
            .from('User')
            .select('id, email')
            .in('id', userIds)
          
          if (usersData) {
            usersData.forEach((user: any) => {
              emailMap[user.id] = user.email || 'Unknown'
            })
          }
        } catch (err) {
          console.log('Error fetching user emails:', err)
        }
      }
      
      // Combine dues with emails
      const transformedDues = (duesData || []).map((due: any) => ({
        id: due.id,
        session_id: due.session_id,
        user_id: due.user_id,
        amount: due.amount ? parseFloat(due.amount.toString()) * 100 : 0, // Convert to cents
        Description: due.Description,
        paid: false, // Your schema doesn't have a paid field, so we'll default to false
        created_at: due.created_at,
        user_email: emailMap[due.user_id] || 'Unknown'
      }))
      
      setDues(transformedDues)
    } catch (error) {
      console.error('Error loading dues:', error)
    } finally {
      setLoading(false)
    }
  }, [groupId, userId])

  // Check if user is owner
  const checkOwnership = useCallback(async () => {
    if (!userId || !groupId) return
    
    try {
      const { data, error } = await supabase
        .from('GroupMember')
        .select('role')
        .eq('id', groupId)
        .eq('user_id', userId)
        .single()

      if (!error && data) {
        setIsOwner(data.role === 'owner')
      }
    } catch (error) {
      console.error('Error checking ownership:', error)
    }
  }, [userId, groupId])

  // Only the owner ever gets rows back here — RLS scopes JoinRequest reads to
  // the group's owner or the requester themselves (see add_join_requests.sql).
  const loadJoinRequests = useCallback(async () => {
    if (!groupId) return

    try {
      const { data: requestsData, error } = await supabase
        .from('JoinRequest')
        .select('id, user_id, created_at')
        .eq('group_id', groupId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })

      if (error) throw error

      const userIds = [...new Set((requestsData || []).map((r: any) => r.user_id))]
      const userMap: Record<number, { username: string; first_name: string; last_name: string; avatar_url: string | null }> = {}

      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from('User')
          .select('id, username, first_name, last_name, avatar_url')
          .in('id', userIds)

        if (usersData) {
          usersData.forEach((u: any) => {
            userMap[u.id] = {
              username: u.username || 'Unknown',
              first_name: u.first_name || '',
              last_name: u.last_name || '',
              avatar_url: u.avatar_url || null,
            }
          })
        }
      }

      const formatted = (requestsData || []).map((r: any) => {
        const u = userMap[r.user_id]
        const firstName = u?.first_name || u?.username || 'Unknown'
        const capitalizedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
        const displayName = u?.last_name
          ? `${capitalizedFirstName} ${u.last_name.charAt(0).toUpperCase()}.`
          : capitalizedFirstName

        return {
          id: r.id,
          user_id: r.user_id,
          displayName,
          username: u?.username || 'Unknown',
          avatar_url: u?.avatar_url || null,
          created_at: r.created_at,
        }
      })

      setPendingJoinRequests(formatted)
    } catch (error) {
      console.error('Error loading join requests:', error)
    }
  }, [groupId])

  const loadMembers = useCallback(async () => {
    if (!groupId) return
    
    try {
      const { data: memberData, error } = await supabase
        .from('GroupMember')
        .select('*')
        .eq('id', groupId)
        .order('created_at', { ascending: true })

      if (error) throw error

      // Fetch user emails, usernames, names, and avatars. Payment method
      // handles live behind ProfileModal, which fetches them itself when
      // someone's profile is actually opened — no need to carry them here.
      const userIds = [...new Set((memberData || []).map((m: any) => m.user_id))]
      const userMap: Record<number, { email: string; username: string; first_name: string; last_name: string; avatar_url: string | null }> = {}

      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from('User')
          .select('id, email, username, first_name, last_name, avatar_url')
          .in('id', userIds)

        if (usersData) {
          usersData.forEach((u: any) => {
            userMap[u.id] = {
              email: u.email || 'Unknown',
              username: u.username || 'Unknown',
              first_name: u.first_name || '',
              last_name: u.last_name || '',
              avatar_url: u.avatar_url || null,
            }
          })
        }
      }

      const transformedMembers = (memberData || []).map((member: any) => ({
        id: member.id,
        user_id: member.user_id,
        role: member.role,
        created_at: member.created_at,
        status: member.status || 'active', // falls back to active pre-migration, when the column doesn't exist yet
        email: userMap[member.user_id]?.email || 'Unknown',
        username: userMap[member.user_id]?.username || 'Unknown',
        first_name: userMap[member.user_id]?.first_name || '',
        last_name: userMap[member.user_id]?.last_name || '',
        avatar_url: userMap[member.user_id]?.avatar_url || null,
      }))

      setMembers(transformedMembers)
    } catch (error) {
      console.error('Error loading members:', error)
    }
  }, [groupId])

  const loadSessions = useCallback(async () => {
    if (!groupId || !userId) return
    
    try {
      const { data: sessionsData, error } = await supabase
        .from('Session')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })

      if (error) throw error

      // For each session, fetch payment data to calculate member count, total amount, and user's payment
      const sessionsWithStats = await Promise.all(
        (sessionsData || []).map(async (session: any) => {
          const { data: paymentsData, error: paymentsError } = await supabase
            .from('SessionPayment')
            .select('amount, user_id')
            .eq('session_id', session.id)

          if (paymentsError) {
            console.error('Error loading payments for session:', paymentsError)
            return {
              ...session,
              memberCount: 0,
              totalAmount: 0,
              userPayment: null
            }
          }

          const memberCount = paymentsData?.length || 0
          // Sum of absolute values of amounts
          const totalAmount = (paymentsData || []).reduce((sum: number, payment: any) => {
            return sum + Math.abs(parseFloat(payment.amount?.toString() || '0'))
          }, 0)

          // Find user's payment in this session
          const userPaymentData = paymentsData?.find((p: any) => p.user_id === userId)
          const userPayment = userPaymentData ? parseFloat(userPaymentData.amount?.toString() || '0') : null

          return {
            ...session,
            memberCount,
            totalAmount,
            userPayment
          }
        })
      )

      // Mark sessions with pending approvals
      const sessionsWithApprovals = await Promise.all(
        sessionsWithStats.map(async (session) => {
          // Check if current user has pending approval for this session (as approver)
          const { data: userApproval } = await supabase
            .from('SessionEditApproval')
            .select('*')
            .eq('session_id', session.id)
            .eq('approver_user_id', userId)
            .eq('status', 'pending')
            .maybeSingle()

          // Check if current user is editor and has pending rejections (not dismissed)
          let rejectionData = null
          
          // Try query with dismissed_at filter first - use .select() to get all records
          const { data: rejectionDataList, error: rejectionError } = await supabase
            .from('SessionEditApproval')
            .select('*')
            .eq('session_id', session.id)
            .eq('editor_user_id', userId)
            .eq('status', 'rejected')
            .is('dismissed_at', null) // Only get undismissed rejections
          
          // Debug: Log the query result
          console.log(`Checking rejection for session ${session.id}, userId ${userId}:`, {
            rejectionDataList,
            rejectionError,
            errorMessage: rejectionError?.message,
            count: rejectionDataList?.length || 0
          })
          
          // If query failed (column might not exist), try without the filter
          if (rejectionError && (rejectionError.message?.includes('dismissed_at') || rejectionError.message?.includes('column'))) {
            console.log('dismissed_at column might not exist, trying fallback query')
            const { data: fallbackData, error: fallbackError } = await supabase
              .from('SessionEditApproval')
              .select('*')
              .eq('session_id', session.id)
              .eq('editor_user_id', userId)
              .eq('status', 'rejected')
            
            console.log('Fallback query result:', { fallbackData, fallbackError, count: fallbackData?.length || 0 })
            rejectionData = fallbackData && fallbackData.length > 0 ? fallbackData[0] : null
          } else {
            rejectionData = rejectionDataList && rejectionDataList.length > 0 ? rejectionDataList[0] : null
          }

          // Check if current user is editor and has pending approvals (waiting for others)
          const { data: editorPendingApprovals } = await supabase
            .from('SessionEditApproval')
            .select('*')
            .eq('session_id', session.id)
            .eq('editor_user_id', userId)
            .eq('status', 'pending')

          const waitingForApproval = editorPendingApprovals && editorPendingApprovals.length > 0

          // Mark as pending rejection if there's an undismissed rejection
          const hasPendingRejection = !!rejectionData

          // Did *I* reject this as the approver? If so, and the session never had any
          // real SessionPayment rows (a brand-new payment/session proposal rather than
          // an edit to one that already existed), it should disappear from my view
          // right away rather than sitting around as an empty shell — I already said
          // "no" to it. The editor still sees a rejection notice until they dismiss it
          // (see the dismiss handler in renderSessionExpansion), which is what actually
          // deletes the underlying rows.
          const { data: myRejection } = await supabase
            .from('SessionEditApproval')
            .select('id')
            .eq('session_id', session.id)
            .eq('approver_user_id', userId)
            .eq('status', 'rejected')
            .maybeSingle()

          const rejectedByMeAsProposal = !!myRejection && (session.memberCount || 0) === 0
          
          // Debug logging - log all sessions to see what's happening
          console.log(`Session ${session.id} (${session.Description || 'Untitled'}):`, {
            rejectionData,
            hasPendingRejection,
            userId,
            sessionId: session.id,
            rejectionDataList,
            rejectionError: rejectionError?.message
          })

          return {
            ...session,
            pendingApproval: !!userApproval,
            pendingRejection: hasPendingRejection,
            waitingForApproval: waitingForApproval,
            rejectedByMeAsProposal,
            pendingIsDeletion: !!userApproval?.is_deletion || !!editorPendingApprovals?.[0]?.is_deletion
          }
        })
      )

      setSessions(sessionsWithApprovals)
    } catch (error) {
      console.error('Error loading sessions:', error)
    }
  }, [groupId, userId])

  const loadPendingApprovals = useCallback(async () => {
    if (!userId || !groupId) return

    try {
      // Load pending approvals where current user is the approver
      const { data: approvalsData } = await supabase
        .from('SessionEditApproval')
        .select(`
          *,
          Session!inner(id, Description, group_id)
        `)
        .eq('approver_user_id', userId)
        .eq('status', 'pending')

      let formattedApprovals: Array<{ id: number; session_id: number; editor_user_id: number; old_amount: number; new_amount: number; session_description: string }> = []
      let formattedRejections: Array<{ id: number; session_id: number; approver_user_id: number; session_description: string; approver_name?: string; approver_email?: string; rejected_at?: string; rejection_reason?: string | null }> = []
      
      if (approvalsData) {
        // Filter to only approvals for sessions in this group
        const groupApprovals = approvalsData.filter((a: any) => 
          a.Session?.group_id === groupId
        )

        // Get session descriptions
        const sessionIds = [...new Set(groupApprovals.map((a: any) => a.session_id))]
        const { data: sessionsData } = await supabase
          .from('Session')
          .select('id, Description')
          .in('id', sessionIds)

        const sessionMap: Record<number, string> = {}
        if (sessionsData) {
          sessionsData.forEach((s: any) => {
            sessionMap[s.id] = s.Description || 'Untitled Session'
          })
        }

        formattedApprovals = groupApprovals.map((a: any) => ({
          id: a.id,
          session_id: a.session_id,
          editor_user_id: a.editor_user_id,
          old_amount: parseFloat(a.old_amount?.toString() || '0'),
          new_amount: parseFloat(a.new_amount?.toString() || '0'),
          session_description: sessionMap[a.session_id] || 'Untitled Session',
          is_deletion: !!a.is_deletion
        }))

        setPendingApprovals(formattedApprovals)
      }

      // Load pending rejections where current user is the editor (not dismissed)
      let rejectionsData = null
      
      // Try query with dismissed_at filter first
      const { data: rejectionsDataWithFilter, error: rejectionsError } = await supabase
        .from('SessionEditApproval')
        .select(`
          *,
          Session!inner(id, Description, group_id)
        `)
        .eq('editor_user_id', userId)
        .eq('status', 'rejected')
        .is('dismissed_at', null) // Only get undismissed rejections
      
      // If query failed (column might not exist), try without the filter
      if (rejectionsError && (rejectionsError.message?.includes('dismissed_at') || rejectionsError.message?.includes('column'))) {
        const { data: fallbackData } = await supabase
          .from('SessionEditApproval')
          .select(`
            *,
            Session!inner(id, Description, group_id)
          `)
          .eq('editor_user_id', userId)
          .eq('status', 'rejected')
        
        rejectionsData = fallbackData
      } else {
        rejectionsData = rejectionsDataWithFilter
      }

      if (rejectionsData) {
        const groupRejections = rejectionsData.filter((r: any) => 
          r.Session?.group_id === groupId
        )

        const sessionIds = [...new Set(groupRejections.map((r: any) => r.session_id))]
        const { data: sessionsData } = await supabase
          .from('Session')
          .select('id, Description')
          .in('id', sessionIds)

        const sessionMap: Record<number, string> = {}
        if (sessionsData) {
          sessionsData.forEach((s: any) => {
            sessionMap[s.id] = s.Description || 'Untitled Session'
          })
        }

        // Get approver user information
        const approverUserIds = [...new Set(groupRejections.map((r: any) => r.approver_user_id))]
        const { data: approverUsers } = await supabase
          .from('User')
          .select('id, username, email, first_name, last_name')
          .in('id', approverUserIds)

        const approverMap: Record<number, { username: string; email: string; first_name?: string; last_name?: string }> = {}
        if (approverUsers) {
          approverUsers.forEach((u: any) => {
            approverMap[u.id] = {
              username: u.username || 'Unknown',
              email: u.email || 'Unknown',
              first_name: u.first_name || '',
              last_name: u.last_name || ''
            }
          })
        }

        formattedRejections = groupRejections.map((r: any) => {
          const approver = approverMap[r.approver_user_id]
          let approverName = 'Unknown'
          
          if (approver) {
            if (approver.first_name) {
              // Capitalize first letter of first name
              const capitalizedFirstName = approver.first_name.charAt(0).toUpperCase() + approver.first_name.slice(1).toLowerCase()
              
              if (approver.last_name) {
                // Capitalize last initial
                const lastInitial = approver.last_name.charAt(0).toUpperCase()
                approverName = `${capitalizedFirstName} ${lastInitial}.`
              } else {
                approverName = capitalizedFirstName
              }
            } else {
              approverName = approver.username || 'Unknown'
            }
          }
          
          return {
            id: r.id,
            session_id: r.session_id,
            approver_user_id: r.approver_user_id,
            session_description: sessionMap[r.session_id] || 'Untitled Session',
            approver_name: approverName,
            approver_email: approver?.email || 'Unknown',
            rejected_at: r.created_at || new Date().toISOString(),
            is_deletion: !!r.is_deletion,
            rejection_reason: r.rejection_reason || null
          }
        })

        setPendingRejections(formattedRejections)
      }

      // Load cancellation notices: sessions where the current user already approved or
      // rejected an edit, and the editor then cancelled the whole edit before it resolved.
      const { data: cancellationsData } = await supabase
        .from('SessionEditApproval')
        .select(`
          *,
          Session!inner(id, Description, group_id)
        `)
        .eq('approver_user_id', userId)
        .eq('status', 'cancelled')
        .is('dismissed_at', null)

      if (cancellationsData) {
        const groupCancellations = cancellationsData.filter((c: any) =>
          c.Session?.group_id === groupId
        )

        const formattedCancellations = groupCancellations.map((c: any) => ({
          id: c.id,
          session_id: c.session_id,
          session_description: c.Session?.Description || 'Untitled Session',
          old_amount: parseFloat(c.old_amount?.toString() || '0'),
          new_amount: parseFloat(c.new_amount?.toString() || '0'),
          is_deletion: !!c.is_deletion,
        }))

        setPendingCancellations(formattedCancellations)
      }

      // Load rejection notices where the current user was a co-approver (not the one
      // who rejected) — one rejection voids the edit for everyone reviewing it, so
      // everyone else gets told, separately from the editor's own dedicated notice.
      const { data: rejectionNoticesData } = await supabase
        .from('SessionEditApproval')
        .select(`
          *,
          Session!inner(id, Description, group_id)
        `)
        .eq('approver_user_id', userId)
        .eq('status', 'rejected_notice')
        .is('dismissed_at', null)

      if (rejectionNoticesData) {
        const groupNotices = rejectionNoticesData.filter((n: any) =>
          n.Session?.group_id === groupId
        )

        // Figure out who actually rejected each affected session, for display.
        const sessionIds = [...new Set(groupNotices.map((n: any) => n.session_id))]
        const { data: rejectorRows } = await supabase
          .from('SessionEditApproval')
          .select('session_id, approver_user_id')
          .in('session_id', sessionIds.length ? sessionIds : [0])
          .eq('status', 'rejected')

        const rejectorBySession: Record<number, number> = {}
        ;(rejectorRows || []).forEach((r: any) => {
          rejectorBySession[r.session_id] = r.approver_user_id
        })

        const rejectorUserIds = [...new Set(Object.values(rejectorBySession))]
        const { data: rejectorUsers } = await supabase
          .from('User')
          .select('id, username, first_name, last_name')
          .in('id', rejectorUserIds.length ? rejectorUserIds : [0])

        const rejectorMap: Record<number, { username: string; first_name?: string; last_name?: string }> = {}
        if (rejectorUsers) {
          rejectorUsers.forEach((u: any) => {
            rejectorMap[u.id] = { username: u.username || 'Unknown', first_name: u.first_name || '', last_name: u.last_name || '' }
          })
        }

        const formattedRejectionNotices = groupNotices.map((n: any) => {
          const rejectorId = rejectorBySession[n.session_id]
          const rejector = rejectorId ? rejectorMap[rejectorId] : undefined
          let rejectedByName = 'a member'

          if (rejector) {
            if (rejector.first_name) {
              const capitalizedFirstName = rejector.first_name.charAt(0).toUpperCase() + rejector.first_name.slice(1).toLowerCase()
              rejectedByName = rejector.last_name
                ? `${capitalizedFirstName} ${rejector.last_name.charAt(0).toUpperCase()}.`
                : capitalizedFirstName
            } else {
              rejectedByName = rejector.username || 'a member'
            }
          }

          return {
            id: n.id,
            session_id: n.session_id,
            session_description: n.Session?.Description || 'Untitled Session',
            rejected_by_name: rejectedByName,
            is_deletion: !!n.is_deletion,
          }
        })

        setPendingRejectionNotices(formattedRejectionNotices)
      }
    } catch (error) {
      console.error('Error loading pending approvals:', error)
    }
  }, [userId, groupId])

  const handleAddSessionClick = () => {
    if (!userId || members.length === 0) return

    // Auto-add current user to session
    const currentUserMember = members.find(m => m.user_id === userId)
    if (currentUserMember) {
      setSessionMembers([{
        user_id: currentUserMember.user_id,
        email: currentUserMember.email || 'Unknown',
        username: currentUserMember.username || 'Unknown',
        first_name: currentUserMember.first_name || '',
        last_name: currentUserMember.last_name || '',
        amount: ''
      }])
    }
    setEditingSessionId(null)
    setSessionDescription('')
    setSplitTotalAmount('')
    setSplitPayerId(userId)
    setShowAddSession(true)
  }

  const loadSessionDetails = async (sessionId: number) => {
    try {
      // Load session payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('SessionPayment')
        .select('*')
        .eq('session_id', sessionId)

      if (paymentsError) throw paymentsError

      // Map payments to session details format
      const detailsWithUserInfo = (paymentsData || []).map((payment: any) => {
        const member = members.find(m => m.user_id === payment.user_id)
        return {
          user_id: payment.user_id,
          email: member?.email || 'Unknown',
          username: member?.username || 'Unknown',
          first_name: member?.first_name || '',
          last_name: member?.last_name || '',
          amount: parseFloat(payment.amount?.toString() || '0')
        }
      })

      setSessionDetails(detailsWithUserInfo)
    } catch (error: any) {
      console.error('Error loading session details:', error)
      setSessionDetails([])
    }
  }

  const handleViewSession = guard(
    (sessionId: number) => `viewSession:${sessionId}`,
    async (sessionId: number) => {
      setViewingSessionId(sessionId)
      await loadSessionDetails(sessionId)
    }
  )

  const handleEditSession = guard(
    (sessionId: number) => `editSession:${sessionId}`,
    async (sessionId: number) => {
    try {
      // Check if there are pending approvals for this session
      const { data: existingApprovals } = await supabase
        .from('SessionEditApproval')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'pending')

      if (existingApprovals && existingApprovals.length > 0) {
        showToast('This session has pending approvals. Please wait for all users to approve or reject the changes before editing again.')
        return
      }

      // Load session data
      const { data: sessionData, error: sessionError } = await supabase
        .from('Session')
        .select('*')
        .eq('id', sessionId)
        .single()

      if (sessionError) throw sessionError

      // Load session payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('SessionPayment')
        .select('*')
        .eq('session_id', sessionId)

      if (paymentsError) throw paymentsError

      // Map payments to session members format
      const paymentsWithUserInfo = (paymentsData || []).map((payment: any) => {
        const member = members.find(m => m.user_id === payment.user_id)
        return {
          user_id: payment.user_id,
          email: member?.email || 'Unknown',
          username: member?.username || 'Unknown',
          first_name: member?.first_name || '',
          last_name: member?.last_name || '',
          amount: payment.amount ? parseFloat(payment.amount.toString()).toFixed(2) : '0.00'
        }
      })

      setSessionDescription(sessionData.Description || '')
      setSessionMembers(paymentsWithUserInfo)
      setSplitTotalAmount('')
      setSplitPayerId(paymentsWithUserInfo.some((p: any) => p.user_id === userId) ? userId : (paymentsWithUserInfo[0]?.user_id ?? null))
      // Store original payments for comparison when saving
      setOriginalPayments((paymentsData || []).map((p: any) => ({
        user_id: p.user_id,
        amount: parseFloat(p.amount?.toString() || '0')
      })))
      setEditingSessionId(sessionId)
      setViewingSessionId(null)
      setShowAddSession(true)
    } catch (error: any) {
      console.error('Error loading session for edit:', error)
      showToast('Failed to load session: ' + (error.message || 'Unknown error'))
    }
    }
  )

  const handleAddMemberToSession = (memberId?: number) => {
    // Find members not already in session (current members only — a removed
    // member can't be added to a new/edited session going forward, though they
    // stay visible on sessions they were already part of)
    const availableMembers = activeMembers.filter(
      m => !sessionMembers.some(sm => sm.user_id === m.user_id)
    )
    
    if (availableMembers.length === 0) {
      showToast('All members are already added to the session')
      setShowMemberDropdown(false)
      return
    }

    // If memberId is provided, add that specific member
    // Otherwise, show dropdown or add first available
    if (memberId) {
      const memberToAdd = availableMembers.find(m => m.user_id === memberId)
      if (memberToAdd) {
        setSessionMembers([...sessionMembers, {
          user_id: memberToAdd.user_id,
          email: memberToAdd.email || 'Unknown',
          username: memberToAdd.username || 'Unknown',
          first_name: memberToAdd.first_name || '',
          last_name: memberToAdd.last_name || '',
          amount: ''
        }])
        // Default the quick-split payer to someone actually in the session
        // once there's a candidate, rather than leaving the dropdown blank.
        setSplitPayerId(prev => prev ?? userId ?? memberToAdd.user_id)
        setShowMemberDropdown(false)
      }
    } else {
      // Toggle dropdown
      setShowMemberDropdown(!showMemberDropdown)
    }
  }

  const handleRemoveMemberFromSession = (user_id: number) => {
    setSessionMembers(sessionMembers.filter(sm => sm.user_id !== user_id))
    if (splitPayerId === user_id) {
      setSplitPayerId(null)
    }
  }

  // Fills in every member's amount from a total + a payer instead of making
  // the user do the division themselves. Works in integer cents so the split
  // always lands on an exact $0.00 sum (session amounts must net to zero) —
  // any odd cents from an uneven division are handed out one at a time
  // starting with the payer, and everyone's individual share is still
  // editable afterward for an uneven split.
  const handleSplitEvenly = () => {
    const totalValue = parseFloat(splitTotalAmount)
    if (!splitTotalAmount || isNaN(totalValue) || totalValue <= 0) {
      showToast('Enter a total amount to split')
      return
    }
    if (sessionMembers.length < 2) {
      showToast('Add at least 2 members to split a payment between them')
      return
    }
    const payerId = splitPayerId ?? sessionMembers[0].user_id
    if (!sessionMembers.some(sm => sm.user_id === payerId)) {
      showToast('Choose who paid')
      return
    }

    const totalCents = Math.round(totalValue * 100)
    const n = sessionMembers.length
    const baseShareCents = Math.floor(totalCents / n)
    let remainderCents = totalCents - baseShareCents * n

    // Hand out the leftover pennies one at a time, starting with the payer,
    // so the shares differ by at most a cent from each other.
    const orderedIds = [payerId, ...sessionMembers.filter(sm => sm.user_id !== payerId).map(sm => sm.user_id)]
    const shareCentsByUser = new Map<number, number>()
    for (const id of orderedIds) {
      const extra = remainderCents > 0 ? 1 : 0
      if (extra) remainderCents -= 1
      shareCentsByUser.set(id, baseShareCents + extra)
    }

    const updated = sessionMembers.map(sm => {
      if (sm.user_id === payerId) {
        // The payer fronted the whole bill, so they're owed back everyone
        // else's share — their own share cancels out of what they front.
        const owedToPayerCents = totalCents - (shareCentsByUser.get(payerId) || 0)
        return { ...sm, amount: (owedToPayerCents / 100).toFixed(2) }
      }
      const shareCents = shareCentsByUser.get(sm.user_id) || 0
      return { ...sm, amount: (-shareCents / 100).toFixed(2) }
    })
    setSessionMembers(updated)
  }

  // The one primitive that actually attributes a payment to the database: set this
  // person's amount on this session, update-if-exists-else-insert. A $0 amount means
  // "no payment" and deletes the row instead, so no meaningless zero rows accumulate.
  // Every session — a group split, a live-session contribution, or a 2-person
  // settle-up payment — is written through this single function.
  const upsertPayment = async (sessionId: number, userId: number, amount: number) => {
    const { data: existing, error: fetchError } = await supabase
      .from('SessionPayment')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchError) throw fetchError

    if (Math.abs(amount) < 0.01) {
      if (existing) {
        const { error } = await supabase.from('SessionPayment').delete().eq('id', existing.id)
        if (error) throw error
      }
      return
    }

    if (existing) {
      const { error } = await supabase.from('SessionPayment').update({ amount }).eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('SessionPayment').insert([{ session_id: sessionId, user_id: userId, amount }])
      if (error) throw error
    }
  }

  // Makes a session's payments exactly match `entries` — for the cases where the
  // caller knows the *complete* membership (creating a session, or editing one
  // directly): removes anyone no longer present, then upserts everyone who is.
  // Not used when the caller only knows a partial set (a live-session contribution,
  // or applying just the changed rows from an approved edit) — those call
  // upsertPayment directly so unrelated members' rows are left untouched.
  const reconcileSession = async (sessionId: number, entries: Array<{ user_id: number; amount: number }>) => {
    const { data: existingRows, error: fetchError } = await supabase
      .from('SessionPayment')
      .select('id, user_id')
      .eq('session_id', sessionId)

    if (fetchError) throw fetchError

    const targetUserIds = new Set(entries.map(e => e.user_id))
    const idsToDelete = (existingRows || [])
      .filter((row: any) => !targetUserIds.has(row.user_id))
      .map((row: any) => row.id)

    if (idsToDelete.length > 0) {
      const { error } = await supabase.from('SessionPayment').delete().in('id', idsToDelete)
      if (error) throw error
    }

    for (const entry of entries) {
      await upsertPayment(sessionId, entry.user_id, entry.amount)
    }
  }

  // The actual removal, shared by the no-one-else-to-ask fast path in
  // handleDeleteSession and the unanimous-approval path in handleApproveEdit.
  const performSessionDeletion = async (sessionId: number) => {
    const { error: approvalsError } = await supabase
      .from('SessionEditApproval')
      .delete()
      .eq('session_id', sessionId)

    if (approvalsError) throw approvalsError

    const { error: paymentsError } = await supabase
      .from('SessionPayment')
      .delete()
      .eq('session_id', sessionId)

    if (paymentsError) throw paymentsError

    const { error: sessionError } = await supabase
      .from('Session')
      .delete()
      .eq('id', sessionId)

    if (sessionError) throw sessionError

    if (viewingSessionId === sessionId) setViewingSessionId(null)
    if (editingSessionId === sessionId) {
      setEditingSessionId(null)
      setShowAddSession(false)
    }
  }

  // A cancelled settle up / payment proposal has no real SessionPayment rows
  // to fall back to (see handleCancelEdit) — it should disappear once
  // there's nothing left for anyone to see about it, rather than sit around
  // forever as an empty $0 session. Call this after any dismissal; it's a
  // no-op for a real session (which always still has its SessionPayment
  // rows) or a proposal someone still needs to see something about.
  const cleanupOrphanedProposalSession = async (sessionId: number) => {
    const { data: paymentRows } = await supabase
      .from('SessionPayment')
      .select('id')
      .eq('session_id', sessionId)
      .limit(1)
    if (paymentRows && paymentRows.length > 0) return

    const { data: approvalRows } = await supabase
      .from('SessionEditApproval')
      .select('status, dismissed_at')
      .eq('session_id', sessionId)
    const stillOutstanding = (approvalRows || []).some(
      (r: any) => r.status === 'pending' || (r.status !== 'approved' && !r.dismissed_at)
    )
    if (stillOutstanding) return

    await supabase.from('SessionEditApproval').delete().eq('session_id', sessionId)
    await supabase.from('Session').delete().eq('id', sessionId)

    if (viewingSessionId === sessionId) setViewingSessionId(null)
  }

  const handleApproveEdit = guard(
    (approvalId: number, sessionId: number) => `approveEdit:${approvalId}`,
    async (approvalId: number, sessionId: number) => {
    try {
      // Update approval status to approved
      const { error: updateError } = await supabase
        .from('SessionEditApproval')
        .update({ status: 'approved' })
        .eq('id', approvalId)

      if (updateError) throw updateError

      // Check if all approvals for this session are now approved
      const { data: allApprovals } = await supabase
        .from('SessionEditApproval')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'pending')

      if (!allApprovals || allApprovals.length === 0) {
        // All approvals are done — apply them
        const { data: approvedChanges } = await supabase
          .from('SessionEditApproval')
          .select('*')
          .eq('session_id', sessionId)
          .eq('status', 'approved')

        if (approvedChanges && approvedChanges.length > 0) {
          if (approvedChanges[0].is_deletion) {
            // Everyone approved deleting the session — remove it outright
            // rather than applying the $0 amounts, then stop.
            await performSessionDeletion(sessionId)
            showToast('Everyone approved. session deleted.')
            await loadSessions()
            await loadDues()
            await loadPendingApprovals()
            return
          }

          // Apply each approved change. Only the changed rows are known here (not
          // the session's full membership), so this upserts each one directly
          // rather than reconciling against the full set — anyone whose amount
          // didn't change isn't touched.
          for (const change of approvedChanges) {
            await upsertPayment(sessionId, change.approver_user_id, change.new_amount)
          }

          // Delete all approval records for this session
          await supabase
            .from('SessionEditApproval')
            .delete()
            .eq('session_id', sessionId)

          showToast('Changes approved and applied.')
        }
      } else {
        showToast('Approved. waiting on others.')
      }

      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
    } catch (error: any) {
      console.error('Error approving edit:', error)
      showToast('Failed to approve edit: ' + (error.message || 'Unknown error'))
    }
    }
  )

  const handleRejectEdit = guard(
    (approvalId: number, sessionId: number, editorUserId: number, reason: string) => `rejectEdit:${approvalId}`,
    async (approvalId: number, sessionId: number, editorUserId: number, reason: string) => {
    try {
      // Update approval status to rejected
      const { data: rejectedRow, error: updateError } = await supabase
        .from('SessionEditApproval')
        .update({ status: 'rejected', rejection_reason: reason })
        .eq('id', approvalId)
        .select('is_deletion')
        .single()

      if (updateError) throw updateError

      const isDeletion = !!rejectedRow?.is_deletion

      // One rejection voids the edit for everyone — that's intended. But instead of
      // silently deleting every other approver's record (pending or already-approved),
      // mark them 'rejected_notice' so each of them gets told the edit they were
      // reviewing was rejected (see loadPendingApprovals / pendingRejectionNotices).
      // The editor gets a separate, dedicated notice below instead, so their own
      // auto-approved record is excluded here and cleaned up afterward.
      const { data: otherApproverRows, error: otherRowsError } = await supabase
        .from('SessionEditApproval')
        .select('id, approver_user_id')
        .eq('session_id', sessionId)
        .in('status', ['pending', 'approved'])
        .neq('id', approvalId)

      if (otherRowsError) throw otherRowsError

      const idsToNotify = (otherApproverRows || [])
        .filter((row: any) => row.approver_user_id !== editorUserId)
        .map((row: any) => row.id)

      if (idsToNotify.length > 0) {
        const { error: notifyOthersError } = await supabase
          .from('SessionEditApproval')
          .update({ status: 'rejected_notice' })
          .in('id', idsToNotify)

        if (notifyOthersError) throw notifyOthersError
      }

      // Clean up the editor's own leftover record(s) — no longer needed now that
      // they get their own notice via the insert-if-not-exists check below.
      await supabase
        .from('SessionEditApproval')
        .delete()
        .eq('session_id', sessionId)
        .eq('approver_user_id', editorUserId)
        .neq('id', approvalId)

      // Create a rejection notification for the editor
      // Check if a rejection notification already exists to avoid duplicates
      const { data: existingRejection } = await supabase
        .from('SessionEditApproval')
        .select('id')
        .eq('session_id', sessionId)
        .eq('editor_user_id', editorUserId)
        .eq('status', 'rejected')
        .is('dismissed_at', null)
        .maybeSingle()
      
      if (!existingRejection) {
        const { data: insertedRejection, error: notifyError } = await supabase
          .from('SessionEditApproval')
          .insert([{
            session_id: sessionId,
            editor_user_id: editorUserId,
            approver_user_id: userId,
            status: 'rejected',
            old_amount: 0,
            new_amount: 0,
            is_deletion: isDeletion,
            rejection_reason: reason
          }])
          .select()
          .single()

        console.log('Created rejection notification:', insertedRejection, 'error:', notifyError)

        if (notifyError) {
          console.error('Error creating rejection notification:', notifyError)
          // If column doesn't exist, try without dismissed_at check
          if (notifyError.message?.includes('dismissed_at') || notifyError.message?.includes('column')) {
            const { data: fallbackInsert, error: fallbackError } = await supabase
              .from('SessionEditApproval')
              .insert([{
                session_id: sessionId,
                editor_user_id: editorUserId,
                approver_user_id: userId,
                status: 'rejected',
                old_amount: 0,
                new_amount: 0,
                rejection_reason: reason
              }])
              .select()
              .single()
            
            console.log('Fallback insert result:', fallbackInsert, 'error:', fallbackError)
          }
        }
      } else {
        console.log('Rejection notification already exists:', existingRejection)
      }

      showToast(
        isDeletion
          ? 'Deletion rejected. the session was kept as-is. Everyone who was reviewing it has been notified.'
          : 'Edit rejected. The editor and everyone else reviewing it have been notified.'
      )

      // Reload everything to show the rejection
      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
    } catch (error: any) {
      console.error('Error rejecting edit:', error)
      showToast('Failed to reject edit: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Editor cancels their own pending edit, settle up, payment, or deletion
  // request. An 'edit' keeps the session at its pre-edit amounts and a
  // 'deletion' request just stops threatening the session — neither one
  // touches the Session row itself. A settle up / payment never had any real
  // SessionPayment rows behind it in the first place (see PendingSessionKind
  // above), so cancelling one removes the shell Session too — right away if
  // nobody had acted on it yet, or once every approver who had already
  // weighed in has seen the cancellation notice and dismissed it (see
  // cleanupOrphanedProposalSession, called from handleDismissCancellation).
  //
  // Either way, approvers who hadn't acted yet are simply cleared (nothing
  // to notify). Approvers who had already approved or rejected are marked
  // 'cancelled' instead of deleted, so they can be notified their review was
  // voided (surfaced in the Dues tab's Pending Actions area — see
  // loadPendingApprovals / pendingCancellations) and view the session before
  // dismissing it for good.
  const handleCancelEdit = guard(
    (sessionId: number) => `cancelEdit:${sessionId}`,
    async (sessionId: number) => {
    if (!userId) return

    try {
      const targetSession = sessions.find(s => s.id === sessionId)
      const kind = pendingSessionKind(targetSession || {})
      const isProposal = (kind === 'settleUp' || kind === 'payment') && (targetSession?.memberCount || 0) === 0

      const { data: rows, error: fetchError } = await supabase
        .from('SessionEditApproval')
        .select('*')
        .eq('session_id', sessionId)
        .eq('editor_user_id', userId)
        .is('dismissed_at', null)

      if (fetchError) throw fetchError

      const toDelete: number[] = []
      const toCancel: number[] = []

      ;(rows || []).forEach((row: any) => {
        if (row.approver_user_id === userId) {
          // The editor's own auto-approved record — nothing to notify themselves about.
          toDelete.push(row.id)
        } else if (row.status === 'pending') {
          // They hadn't acted yet — just clear it, nothing was decided.
          toDelete.push(row.id)
        } else {
          // They already approved or rejected — let them know it was voided.
          toCancel.push(row.id)
        }
      })

      if (isProposal && toCancel.length === 0) {
        // Nobody else had acted on it yet — nothing to notify, so the whole
        // proposal just disappears.
        await performSessionDeletion(sessionId)
      } else {
        if (toDelete.length > 0) {
          const { error } = await supabase.from('SessionEditApproval').delete().in('id', toDelete)
          if (error) throw error
        }

        if (toCancel.length > 0) {
          const { error } = await supabase
            .from('SessionEditApproval')
            .update({ status: 'cancelled' })
            .in('id', toCancel)
          if (error) throw error
        }
      }

      setConfirmCancelEditSessionId(null)
      if (viewingSessionId === sessionId) setViewingSessionId(null)
      await loadSessions()
      await loadPendingApprovals()
    } catch (error: any) {
      console.error('Error cancelling edit:', error)
      showToast('Failed to cancel edit: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Approver acknowledges that their review of an edit was voided by the editor cancelling it.
  const handleDismissCancellation = guard(
    (id: number) => `dismissCancellation:${id}`,
    async (id: number) => {
    try {
      const notice = pendingCancellations.find(c => c.id === id)

      const { error } = await supabase
        .from('SessionEditApproval')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
      setPendingCancellations(prev => prev.filter(c => c.id !== id))

      // If this was the last outstanding notice on a cancelled proposal,
      // it's now safe to remove the shell Session for good.
      if (notice) {
        await cleanupOrphanedProposalSession(notice.session_id)
        await loadSessions()
      }
    } catch (error: any) {
      console.error('Error dismissing cancellation notice:', error)
      showToast('Failed to dismiss notice: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Co-approver acknowledges that an edit they were reviewing was rejected by someone else.
  const handleDismissRejectionNotice = guard(
    (id: number) => `dismissRejectionNotice:${id}`,
    async (id: number) => {
    try {
      const { error } = await supabase
        .from('SessionEditApproval')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
      setPendingRejectionNotices(prev => prev.filter(n => n.id !== id))
    } catch (error: any) {
      console.error('Error dismissing rejection notice:', error)
      showToast('Failed to dismiss notice: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Helper function to update session payments
  // Thin wrapper: the session-edit form always knows the complete membership, so
  // reconcile against it directly.
  const updateSessionPayments = async (sessionId: number) => {
    await reconcileSession(sessionId, sessionMembers.map(sm => ({ user_id: sm.user_id, amount: parseFloat(sm.amount) })))
  }

  const handleCreateSession = guard('createSession', async (e: React.FormEvent) => {
    e.preventDefault()
    if (!groupId || !userId || sessionMembers.length === 0) return

    // Validate all amounts are filled
    const invalidMembers = sessionMembers.filter(sm => !sm.amount || isNaN(parseFloat(sm.amount)))
    if (invalidMembers.length > 0) {
      showToast('Please enter valid amounts for all members')
      return
    }

    // Calculate sum of all amounts
    const total = sessionMembers.reduce((sum, sm) => {
      return sum + parseFloat(sm.amount || '0')
    }, 0)

    // Enforce that sum equals 0
    if (Math.abs(total) > 0.01) { // Allow small floating point differences
      showToast(`The sum of all amounts must equal 0. Current sum: ${total.toFixed(2)}`)
      return
    }

    try {
      if (editingSessionId) {
        // The Edit action is only ever reachable for closed sessions (the UI hides it
        // for live ones — those are edited via the live-session panel instead), so an
        // edit here always goes through the approval flow: track changes and create
        // approval records.
        {
          const changedUsers: Array<{ user_id: number; old_amount: number; new_amount: number }> = []
          
          // Compare new amounts with original amounts
          for (const sm of sessionMembers) {
            const newAmount = parseFloat(sm.amount || '0')
            const originalPayment = originalPayments.find(op => op.user_id === sm.user_id)
            const oldAmount = originalPayment ? originalPayment.amount : 0
            
            // Check if amount changed (allowing for small floating point differences)
            if (Math.abs(newAmount - oldAmount) > 0.01) {
              changedUsers.push({
                user_id: sm.user_id,
                old_amount: oldAmount,
                new_amount: newAmount
              })
            }
          }

          // Also check for removed users (users in original but not in new) — members
          // added to the session are already caught by the loop above, since a missing
          // originalPayment is treated as old_amount 0; a second pass here would double
          // them up into two separate approval records for the same person.
          for (const op of originalPayments) {
            const stillInSession = sessionMembers.some(sm => sm.user_id === op.user_id)
            if (!stillInSession) {
              changedUsers.push({
                user_id: op.user_id,
                old_amount: op.amount,
                new_amount: 0
              })
            }
          }

          if (changedUsers.length > 0 && userId) {
            // Filter out the current user (editor) from approval notifications
            const usersToNotify = changedUsers.filter(cu => cu.user_id !== userId)
            
            // Find the editor's change
            let editorChange = changedUsers.find(cu => cu.user_id === userId)
            
            // If editor's change is not in changedUsers, calculate it from zero-sum constraint
            // Since sessions must sum to 0, if other users' amounts changed, editor's must have changed too
            if (!editorChange && usersToNotify.length > 0) {
              // Calculate editor's old and new amounts based on zero-sum
              const sumOfOthersOld = usersToNotify.reduce((sum, cu) => sum + cu.old_amount, 0)
              const sumOfOthersNew = usersToNotify.reduce((sum, cu) => sum + cu.new_amount, 0)
              
              // Find editor's original payment
              const editorOriginal = originalPayments.find(op => op.user_id === userId)
              const editorOldAmount = editorOriginal ? editorOriginal.amount : -sumOfOthersOld
              
              // Find editor's new payment
              const editorNew = sessionMembers.find(sm => sm.user_id === userId)
              const editorNewAmount = editorNew ? parseFloat(editorNew.amount || '0') : -sumOfOthersNew
              
              // Only create editor change if there's actually a difference
              if (Math.abs(editorOldAmount - editorNewAmount) > 0.01) {
                editorChange = {
                  user_id: userId,
                  old_amount: editorOldAmount,
                  new_amount: editorNewAmount
                }
                console.log('Calculated editor change from zero-sum:', editorChange)
              }
            }
            
            // Create approval records for each affected user (excluding the editor)
            const approvalRecords = usersToNotify.map(cu => ({
              session_id: editingSessionId,
              editor_user_id: userId,
              approver_user_id: cu.user_id,
              status: 'pending',
              old_amount: cu.old_amount,
              new_amount: cu.new_amount
            }))
            
            // ALWAYS create an approval record for the editor if there are any changes
            // This allows us to display the editor's change in the approval UI
            if (editorChange) {
              approvalRecords.push({
                session_id: editingSessionId,
                editor_user_id: userId,
                approver_user_id: userId, // Editor approves their own change (auto-approved)
                status: 'approved', // Mark as approved since editor doesn't need to approve their own change
                old_amount: editorChange.old_amount,
                new_amount: editorChange.new_amount
              })
              console.log('Added editor approval record:', {
                session_id: editingSessionId,
                editor_user_id: userId,
                approver_user_id: userId,
                status: 'approved',
                old_amount: editorChange.old_amount,
                new_amount: editorChange.new_amount
              })
            } else {
              console.warn('No editor change found, but there are other changes. This might indicate a bug.')
            }

            console.log('Creating approval records:', approvalRecords)
            console.log('Changed users:', changedUsers)
            console.log('Users to notify (excluding editor):', usersToNotify)
            console.log('Editor change:', editorChange)
            
            if (approvalRecords.length > 0) {
              const { error: approvalError } = await supabase
                .from('SessionEditApproval')
                .insert(approvalRecords)

              if (approvalError) {
                console.error('Error creating approval records:', approvalError)
                throw approvalError
              }

              console.log('Successfully created approval records:', approvalRecords.length)

              if (usersToNotify.length > 0) {
                // Show message that users will be notified
                showToast(`Edit saved. waiting on ${usersToNotify.length} approval${usersToNotify.length === 1 ? '' : 's'}.`)
              } else {
                // Only the editor's value changed, so no approvals needed - update immediately
                await updateSessionPayments(editingSessionId)
                showToast('Session updated successfully!')
              }
            } else {
              // No changes detected, update normally
              await updateSessionPayments(editingSessionId)
              showToast('Session updated successfully!')
            }
          } else {
            // No changes detected, update normally
            await updateSessionPayments(editingSessionId)
            showToast('Session updated successfully!')
          }
        }

        // Update session description
        const { error: sessionError } = await supabase
          .from('Session')
          .update({
            Description: sessionDescription || null
          })
          .eq('id', editingSessionId)

        if (sessionError) throw sessionError
      } else {
        // Create new session
        const { data: sessionData, error: sessionError } = await supabase
          .from('Session')
          .insert([{
            group_id: groupId,
            Description: sessionDescription || null,
            created_by: userId
          }])
          .select('id')
          .single()

        if (sessionError) throw sessionError

        await reconcileSession(sessionData.id, sessionMembers.map(sm => ({ user_id: sm.user_id, amount: parseFloat(sm.amount) })))

        showToast('Session created successfully!')
      }

      // Reset form and reload
      setSessionDescription('')
      setSessionMembers([])
      setSplitTotalAmount('')
      setSplitPayerId(null)
      setOriginalPayments([])
      setEditingSessionId(null)
      setViewingSessionId(null)
      setShowAddSession(false)
      await loadSessions()
      await loadDues() // Reload dues to show new payments
      await loadPendingApprovals() // Reload pending approvals
    } catch (error: any) {
      console.error('Error saving session:', error)
      showToast('Failed to save session: ' + (error.message || 'Unknown error'))
    }
  })

  const handleCreateLiveSession = guard('createLiveSession', async (description: string) => {
    if (!groupId || !userId) return

    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('Session')
        .insert([{
          group_id: groupId,
          Description: description || 'Live Session',
          is_live: true,
          created_by: userId
        }])
        .select('id')
        .single()

      if (sessionError) throw sessionError

      setShowCreateLiveSessionModal(false)
      setLiveSessionDescription('')
      await loadSessions()
      showToast('Live session created.')
    } catch (error: any) {
      console.error('Error creating live session:', error)
      showToast('Failed to create live session: ' + (error.message || 'Unknown error'))
    }
  })

  const handleAddToLiveSession = guard(
    (sessionId: number) => `addToLiveSession:${sessionId}`,
    async (sessionId: number) => {
    if (!userId || liveSessionAmount === '') return

    const amountValue = parseFloat(liveSessionAmount)
    if (isNaN(amountValue)) {
      showToast('Please enter a valid amount')
      return
    }

    try {
      // Only touch your own row — everyone else's contribution to this live session
      // is untouched, so this can't reconcile against a "full set" (nobody knows the
      // full set yet, that's the point of a live session).
      await upsertPayment(sessionId, userId, amountValue)

      // Close the form and reload sessions list to update stats
      setSelectedLiveSession(null)
      setLiveSessionAmount('')
      setSessionDetails([])
      await loadSessions()
    } catch (error: any) {
      console.error('Error adding to live session:', error)
      showToast('Failed to add payment: ' + (error.message || 'Unknown error'))
    }
    }
  )

  const handleOpenLiveSession = guard(
    (sessionId: number) => `openLiveSession:${sessionId}`,
    async (sessionId: number) => {
    if (!userId) return

    setSelectedLiveSession(sessionId)

    // Load all payments for this session to show other users' values
    try {
      const { data: allPayments, error: paymentsError } = await supabase
        .from('SessionPayment')
        .select('amount, user_id')
        .eq('session_id', sessionId)

      if (paymentsError) throw paymentsError

      // Find the user's current payment
      const userPayment = allPayments?.find((p: any) => p.user_id === userId)
      if (userPayment) {
        setLiveSessionAmount(parseFloat(userPayment.amount?.toString() || '0').toString())
      } else {
        setLiveSessionAmount('')
      }

      // Store all payments for display
      const paymentsWithUserInfo = (allPayments || []).map((payment: any) => {
        const member = members.find(m => m.user_id === payment.user_id)
        return {
          user_id: payment.user_id,
          email: member?.email || 'Unknown',
          username: member?.username || 'Unknown',
          first_name: member?.first_name || '',
          last_name: member?.last_name || '',
          amount: parseFloat(payment.amount?.toString() || '0')
        }
      })

      setSessionDetails(paymentsWithUserInfo)
    } catch (error) {
      console.error('Error loading live session payments:', error)
      setLiveSessionAmount('')
      setSessionDetails([])
    }
    }
  )

  const handleCloseLiveSession = guard(
    (sessionId: number) => `closeLiveSession:${sessionId}`,
    async (sessionId: number) => {
    try {
      // Get all payments for this session
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('SessionPayment')
        .select('amount')
        .eq('session_id', sessionId)

      if (paymentsError) throw paymentsError

      // Calculate sum
      const total = (paymentsData || []).reduce((sum: number, payment: any) => {
        return sum + parseFloat(payment.amount?.toString() || '0')
      }, 0)

      // Check if sum equals 0
      if (Math.abs(total) > 0.01) {
        showToast(`Cannot close session. The sum of all amounts must equal 0. Current sum: ${total.toFixed(2)}`)
        return
      }

      // Close the session
      const { error: updateError } = await supabase
        .from('Session')
        .update({ is_live: false })
        .eq('id', sessionId)

      if (updateError) throw updateError

      // Close the popup and reload sessions
      setSelectedLiveSession(null)
      setLiveSessionAmount('')
      setSessionDetails([])
      await loadSessions()
      showToast('Live session closed successfully!')
    } catch (error: any) {
      console.error('Error closing live session:', error)
      showToast('Failed to close session: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Cancel (abandon) a live session — discards every payment entered so far and
  // removes the session entirely. Distinct from "Close," which finalizes it.
  const handleCancelLiveSession = guard(
    (sessionId: number) => `cancelLiveSession:${sessionId}`,
    async (sessionId: number) => {
    try {
      const { error: paymentsError } = await supabase
        .from('SessionPayment')
        .delete()
        .eq('session_id', sessionId)

      if (paymentsError) throw paymentsError

      const { error: sessionError } = await supabase
        .from('Session')
        .delete()
        .eq('id', sessionId)

      if (sessionError) throw sessionError

      setConfirmCancelSessionId(null)
      setSelectedLiveSession(null)
      setLiveSessionAmount('')
      setSessionDetails([])
      await loadSessions()
      await loadDues()
    } catch (error: any) {
      console.error('Error cancelling live session:', error)
      showToast('Failed to cancel session: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Permanently delete a closed session and everything tied to it.
  // Requests to delete a closed session. Needs unanimous approval from
  // everyone with a payment in it — same mechanism as editing amounts
  // (see handleCreateSession's approval-record creation), just proposing
  // every amount go to $0 with is_deletion marking what that really means.
  // Skips straight to performSessionDeletion only when the requester is the
  // sole participant, since there's no one else to ask.
  const handleDeleteSession = guard(
    (sessionId: number) => `deleteSession:${sessionId}`,
    async (sessionId: number) => {
    if (!userId) return

    try {
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('SessionPayment')
        .select('user_id, amount')
        .eq('session_id', sessionId)

      if (paymentsError) throw paymentsError

      const others = (paymentsData || []).filter((p: any) => p.user_id !== userId)

      if (others.length === 0) {
        await performSessionDeletion(sessionId)
        setConfirmDeleteSessionId(null)
        await loadSessions()
        await loadDues()
        await loadPendingApprovals()
        showToast('Session deleted.')
        return
      }

      const selfPayment = (paymentsData || []).find((p: any) => p.user_id === userId)

      const approvalRecords = [
        ...others.map((p: any) => ({
          session_id: sessionId,
          editor_user_id: userId,
          approver_user_id: p.user_id,
          status: 'pending',
          old_amount: parseFloat(p.amount?.toString() || '0'),
          new_amount: 0,
          is_deletion: true,
        })),
        {
          session_id: sessionId,
          editor_user_id: userId,
          approver_user_id: userId,
          status: 'approved',
          old_amount: selfPayment ? parseFloat(selfPayment.amount?.toString() || '0') : 0,
          new_amount: 0,
          is_deletion: true,
        },
      ]

      const { error: insertError } = await supabase.from('SessionEditApproval').insert(approvalRecords)
      if (insertError) throw insertError

      setConfirmDeleteSessionId(null)
      await loadSessions()
      await loadPendingApprovals()
      showToast(`Deletion requested. ${others.length} member${others.length === 1 ? '' : 's'} must approve before the session is removed.`)
    } catch (error: any) {
      console.error('Error requesting session deletion:', error)
      showToast('Failed to request deletion: ' + (error.message || 'Unknown error'))
    }
    }
  )

  const handleMakePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    // Guards the network round-trip, not just the click — the submit button
    // disables on the same flag, but this also catches a double Enter-key
    // submit that fires before React re-renders the disabled state.
    if (isSubmittingPayment) return
    if (!userId || !groupId || !paymentPayee || !paymentAmount) return

    const amountValue = parseFloat(paymentAmount)
    if (isNaN(amountValue) || amountValue <= 0) {
      showToast('Please enter a valid amount greater than 0')
      return
    }

    setIsSubmittingPayment(true)
    try {
      // Create a new session for this payment
      const payerName = formatDisplayName(members, members.find(m => m.user_id === userId) || { user_id: userId } as GroupMember)
      const payeeName = formatDisplayName(members, members.find(m => m.user_id === paymentPayee) || { user_id: paymentPayee } as GroupMember)
      
      const { data: sessionData, error: sessionError } = await supabase
        .from('Session')
        .insert([{
          group_id: groupId,
          Description: paymentDescription || `Payment from ${payerName} to ${payeeName}`,
          is_payment: true,
          payment_method: paymentMethod || null,
          created_by: userId
        }])
        .select('id')
        .single()

      if (sessionError) throw sessionError

      // A payment is a 2-entry session (same sign convention as any expense:
      // whoever hands over money gets the positive entry, whoever receives it
      // gets the negative one) — but unlike a regular expense, it isn't
      // applied immediately. Anyone could otherwise claim a fake payment to
      // clear their own debt, so it goes through the exact same
      // SessionEditApproval flow as editing an existing session: the payer's
      // side is auto-approved, the payee's is pending until they confirm,
      // and the amounts only land in SessionPayment once every pending row
      // clears (see handleApproveEdit).
      const { error: approvalError } = await supabase
        .from('SessionEditApproval')
        .insert([
          {
            session_id: sessionData.id,
            editor_user_id: userId,
            approver_user_id: userId,
            status: 'approved',
            old_amount: 0,
            new_amount: amountValue,
          },
          {
            session_id: sessionData.id,
            editor_user_id: userId,
            approver_user_id: paymentPayee,
            status: 'pending',
            old_amount: 0,
            new_amount: -amountValue,
          },
        ])

      if (approvalError) throw approvalError

      // Reset form, close the modal, and reload
      setPaymentPayee(null)
      setPaymentAmount('')
      setPaymentDescription('')
      setPaymentMethod('')
      setShowMakePaymentModal(false)
      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
      showToast(`Payment recorded. waiting on ${payeeName} to confirm they received it.`)
    } catch (error: any) {
      console.error('Error making payment:', error)
      showToast('Failed to record payment: ' + (error.message || 'Unknown error'))
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  // Turns the computed minimal plan (or a blank row) into editable leg state.
  const legsFromPlan = (plan: { from: number; to: number; amount: number }[]) =>
    plan.map(leg => ({
      id: settleUpLegIdRef.current++,
      from: leg.from,
      to: leg.to,
      amount: (leg.amount / 100).toFixed(2),
    }))

  const openSettleUpModal = () => {
    setSettleUpLegs(legsFromPlan(computeSettlementPlan(memberBalances)))
    setShowSettleUpModal(true)
  }

  const resetSettleUpLegsToSuggested = () => {
    setSettleUpLegs(legsFromPlan(computeSettlementPlan(memberBalances)))
  }

  const addSettleUpLeg = () => {
    setSettleUpLegs(prev => [...prev, { id: settleUpLegIdRef.current++, from: null, to: null, amount: '' }])
  }

  const updateSettleUpLeg = (id: number, patch: Partial<{ from: number | null; to: number | null; amount: string }>) => {
    setSettleUpLegs(prev => prev.map(leg => (leg.id === id ? { ...leg, ...patch } : leg)))
  }

  const removeSettleUpLeg = (id: number) => {
    setSettleUpLegs(prev => prev.filter(leg => leg.id !== id))
  }

  // A leg only counts once both sides are picked, they're different people,
  // and the amount parses to at least a penny — half-filled rows (still being
  // edited) are simply ignored rather than treated as errors.
  const settleUpLegCents = (leg: { from: number | null; to: number | null; amount: string }): number => {
    if (leg.from === null || leg.to === null || leg.from === leg.to) return 0
    const parsed = parseFloat(leg.amount)
    if (isNaN(parsed) || parsed <= 0) return 0
    return Math.round(parsed * 100)
  }

  // Net effect (in cents) each member's balance moves by if the current legs
  // go through: paying money moves you toward $0 from below (+), receiving it
  // moves you toward $0 from above (-).
  const settleUpNetCents = (legs: { from: number | null; to: number | null; amount: string }[], userIdToCheck: number): number => {
    return legs.reduce((sum, leg) => {
      const cents = settleUpLegCents(leg)
      if (cents === 0) return sum
      if (leg.from === userIdToCheck) return sum + cents
      if (leg.to === userIdToCheck) return sum - cents
      return sum
    }, 0)
  }

  // Zeroes out every member's balance in one shot instead of recording payments
  // pair by pair. Same trust model as handleMakePayment: it only ever claims
  // that debts are settled, so everyone whose balance would move (other than
  // whoever clicked the button) has to confirm before anything actually lands
  // in SessionPayment — see handleApproveEdit, which this reuses unmodified.
  //
  // Unlike a plain "zero everyone out" pass, the amounts here come from
  // whatever payments the user built in the modal (settleUpLegs), not
  // straight from -balance — that's what lets someone reroute who pays whom
  // instead of accepting the auto-suggested minimal plan.
  const handleSettleUp = async () => {
    if (isSubmittingSettleUp) return
    if (!userId || !groupId) return

    const validLegs = settleUpLegs.filter(leg => settleUpLegCents(leg) > 0)

    // Balances always sum to $0 across the group, so this only goes through
    // once every member's balance plus the net effect of their payments lands
    // exactly on $0 — the modal keeps the button disabled until that's true,
    // this is just the last line of defense.
    const stillUnbalanced = memberBalances.some(
      m => m.balance + settleUpNetCents(validLegs, m.user_id) !== 0
    )
    if (stillUnbalanced) {
      showToast('Adjust the payments so every balance reaches $0.00')
      return
    }

    const entries = activeMembers
      .map(m => ({ user_id: m.user_id, netCents: settleUpNetCents(validLegs, m.user_id) }))
      .filter(e => e.netCents !== 0)
      .map(e => ({ user_id: e.user_id, amount: e.netCents / 100 }))

    if (entries.length === 0) {
      showToast("Everyone's already settled up")
      setShowSettleUpModal(false)
      return
    }

    // Record who-pays-who — the actual payments chosen, not just the fact
    // that everyone zeroed out — so the session's notes still explain itself
    // later even after balances have moved on.
    const settlementNotes = validLegs
      .map(leg => {
        const from = members.find(m => m.user_id === leg.from)
        const to = members.find(m => m.user_id === leg.to)
        const fromName = from ? formatDisplayName(members, from) : 'Unknown'
        const toName = to ? formatDisplayName(members, to) : 'Unknown'
        return `${fromName} pays ${toName} $${(settleUpLegCents(leg) / 100).toFixed(2)}`
      })
      .join('\n') || null

    setIsSubmittingSettleUp(true)
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('Session')
        .insert([{
          group_id: groupId,
          Description: 'Group settle up',
          is_payment: true,
          created_by: userId,
          notes: settlementNotes,
        }])
        .select('id')
        .single()

      if (sessionError) throw sessionError

      const approvalRecords = entries.map(entry => ({
        session_id: sessionData.id,
        editor_user_id: userId,
        approver_user_id: entry.user_id,
        status: entry.user_id === userId ? 'approved' : 'pending',
        old_amount: 0,
        new_amount: entry.amount,
      }))

      const { error: approvalError } = await supabase
        .from('SessionEditApproval')
        .insert(approvalRecords)

      if (approvalError) throw approvalError

      const othersCount = approvalRecords.filter(r => r.status === 'pending').length

      setShowSettleUpModal(false)
      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
      showToast(
        othersCount > 0
          ? `Settle up requested. waiting on ${othersCount} member${othersCount === 1 ? '' : 's'} to confirm.`
          : 'Settled up!'
      )
    } catch (error: any) {
      console.error('Error settling up:', error)
      showToast('Failed to settle up: ' + (error.message || 'Unknown error'))
    } finally {
      setIsSubmittingSettleUp(false)
    }
  }

  // Suggested legs for the personal "Settle your balance" modal: the same
  // minimal cash-flow plan the whole-group modal uses, filtered down to just
  // the edges that touch you. Which side of each edge you're on is implied
  // (see settleBalanceDirection) since a member's balance can only be a net
  // debtor or a net creditor, never both at once — so every row you'd ever
  // be on runs the same direction.
  const legsFromPersonalPlan = (plan: { from: number; to: number; amount: number }[]) =>
    plan
      .filter(leg => leg.from === userId || leg.to === userId)
      .map(leg => ({
        id: settleBalanceLegIdRef.current++,
        counterpartyId: leg.from === userId ? leg.to : leg.from,
        amount: (leg.amount / 100).toFixed(2),
      }))

  const openSettleBalanceModal = () => {
    setSettleBalanceLegs(legsFromPersonalPlan(computeSettlementPlan(memberBalances)))
    setShowSettleBalanceModal(true)
  }

  const resetSettleBalanceLegsToSuggested = () => {
    setSettleBalanceLegs(legsFromPersonalPlan(computeSettlementPlan(memberBalances)))
  }

  const addSettleBalanceLeg = () => {
    setSettleBalanceLegs(prev => [...prev, { id: settleBalanceLegIdRef.current++, counterpartyId: null, amount: '' }])
  }

  const updateSettleBalanceLeg = (id: number, patch: Partial<{ counterpartyId: number | null; amount: string }>) => {
    setSettleBalanceLegs(prev => prev.map(leg => (leg.id === id ? { ...leg, ...patch } : leg)))
  }

  const removeSettleBalanceLeg = (id: number) => {
    setSettleBalanceLegs(prev => prev.filter(leg => leg.id !== id))
  }

  // A leg only counts once a counterparty other than yourself is picked and
  // the amount parses to at least a penny — half-filled rows are ignored
  // rather than treated as errors, same as settleUpLegCents.
  const settleBalanceLegCents = (leg: { counterpartyId: number | null; amount: string }): number => {
    if (leg.counterpartyId === null || leg.counterpartyId === userId) return 0
    const parsed = parseFloat(leg.amount)
    if (isNaN(parsed) || parsed <= 0) return 0
    return Math.round(parsed * 100)
  }

  const settleBalanceTotalCents = (legs: { counterpartyId: number | null; amount: string }[]): number =>
    legs.reduce((sum, leg) => sum + settleBalanceLegCents(leg), 0)

  // What a given member's balance would land on if the current draft legs
  // went through — for you, that's every leg (they all run through you); for
  // anyone else, only the legs naming them as the counterparty. Powers the
  // "Balances" list in the modal, the same way settleUpNetCents powers it
  // for the whole-group version.
  const settleBalanceRemaining = (
    member: { user_id: number; balance: number },
    direction: 'pay' | 'receive',
    legs: { counterpartyId: number | null; amount: string }[]
  ): number => {
    const cents = member.user_id === userId
      ? settleBalanceTotalCents(legs)
      : legs.reduce((sum, leg) => (leg.counterpartyId === member.user_id ? sum + settleBalanceLegCents(leg) : sum), 0)
    if (cents === 0) return member.balance
    // Paying moves you up toward $0, and moves whoever you paid down toward
    // $0 by the same amount — and vice versa when you're the one being paid.
    const towardZero = (member.user_id === userId) === (direction === 'pay') ? cents : -cents
    return member.balance + towardZero
  }

  // Zeroes out just your own balance, not the whole group — unlike
  // handleSettleUp, every row already pays or receives against you
  // specifically, so the only thing that has to add up is your own total
  // against what you owe or are owed. Same trust model as handleSettleUp:
  // this only ever claims the debt is settled, so every counterparty still
  // has to confirm before their balance (or yours) actually moves.
  const handleSettleBalance = async () => {
    if (isSubmittingSettleBalance) return
    if (!userId || !groupId || netBalance === 0) return

    const direction: 'pay' | 'receive' = netBalance < 0 ? 'pay' : 'receive'
    const validLegs = settleBalanceLegs.filter(leg => settleBalanceLegCents(leg) > 0)
    const totalCents = settleBalanceTotalCents(validLegs)

    if (totalCents !== Math.abs(netBalance)) {
      showToast('Adjust the payments so your balance reaches $0.00')
      return
    }

    // Collapse rows against the same counterparty into one approval record.
    const counterpartyCents = new Map<number, number>()
    validLegs.forEach(leg => {
      const id = leg.counterpartyId as number
      counterpartyCents.set(id, (counterpartyCents.get(id) || 0) + settleBalanceLegCents(leg))
    })

    // Record who-pays-who — the actual payments chosen — so the session's
    // notes still explain itself later even after balances have moved on.
    const settlementNotes = validLegs
      .map(leg => {
        const counterparty = members.find(m => m.user_id === leg.counterpartyId)
        const counterpartyName = counterparty ? formatDisplayName(members, counterparty) : 'Unknown'
        const cents = settleBalanceLegCents(leg)
        return direction === 'pay'
          ? `You pay ${counterpartyName} $${(cents / 100).toFixed(2)}`
          : `${counterpartyName} pays you $${(cents / 100).toFixed(2)}`
      })
      .join('\n') || null

    setIsSubmittingSettleBalance(true)
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('Session')
        .insert([{
          group_id: groupId,
          Description: 'Settle up',
          is_payment: true,
          created_by: userId,
          notes: settlementNotes,
        }])
        .select('id')
        .single()

      if (sessionError) throw sessionError

      const approvalRecords = [
        {
          session_id: sessionData.id,
          editor_user_id: userId,
          approver_user_id: userId,
          status: 'approved',
          old_amount: 0,
          new_amount: (direction === 'pay' ? totalCents : -totalCents) / 100,
        },
        ...Array.from(counterpartyCents.entries()).map(([counterpartyId, cents]) => ({
          session_id: sessionData.id,
          editor_user_id: userId,
          approver_user_id: counterpartyId,
          status: 'pending',
          old_amount: 0,
          new_amount: (direction === 'pay' ? -cents : cents) / 100,
        })),
      ]

      const { error: approvalError } = await supabase
        .from('SessionEditApproval')
        .insert(approvalRecords)

      if (approvalError) throw approvalError

      const othersCount = approvalRecords.length - 1

      setShowSettleBalanceModal(false)
      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
      showToast(
        othersCount > 0
          ? `Settle up requested. waiting on ${othersCount} member${othersCount === 1 ? '' : 's'} to confirm.`
          : 'Settled up!'
      )
    } catch (error: any) {
      console.error('Error settling balance:', error)
      showToast('Failed to settle up: ' + (error.message || 'Unknown error'))
    } finally {
      setIsSubmittingSettleBalance(false)
    }
  }

  // Load group and dues once userId is set
  useEffect(() => {
    if (userId && groupId && !isNaN(groupId)) {
      loadGroup()
      loadDues()
      checkOwnership()
      loadMembers()
      loadSessions()
      loadPendingApprovals()
      loadJoinRequests()
    }
  }, [userId, groupId, loadGroup, loadDues, checkOwnership, loadMembers, loadSessions, loadPendingApprovals, loadJoinRequests])

  // Keep the group settings form in sync with the loaded group — re-syncs
  // after a save too, so the drafts reflect whatever actually persisted.
  useEffect(() => {
    if (group) {
      setGroupNameDraft(group.name || '')
      setGroupDescriptionDraft(group.description || '')
    }
  }, [group?.id, group?.name, group?.description])

  // Load session details when viewing a session
  useEffect(() => {
    if (viewingSessionId) {
      loadSessionDetails(viewingSessionId)
      
      // Load all approval records for this session to show all changes
      const fetchAllApprovals = async () => {
        // Fetch both pending and approved records to show all changes including editor's
        const { data: approvalsData, error } = await supabase
          .from('SessionEditApproval')
          .select('approver_user_id, old_amount, new_amount, editor_user_id, status')
          .eq('session_id', viewingSessionId)
          .in('status', ['pending', 'approved']) // Include both pending and approved (editor's change)
        
        if (error) {
          console.error('Error fetching approval records:', error)
          setAllSessionApprovals([])
          setEditorUserId(null)
          return
        }
        
        console.log('Fetched approval records for session', viewingSessionId, ':', approvalsData)
        console.log('Number of approval records found:', approvalsData?.length || 0)
        
        if (approvalsData && approvalsData.length > 0) {
          // Get editor user ID from the first approval record
          const editorId = approvalsData[0]?.editor_user_id
          setEditorUserId(editorId || null)
          console.log('Editor user ID from approval records:', editorId)
          
          // Map approval records for all users (including editor)
          const mappedApprovals = approvalsData.map((a: any) => ({
            user_id: a.approver_user_id,
            old_amount: parseFloat(a.old_amount?.toString() || '0'),
            new_amount: parseFloat(a.new_amount?.toString() || '0'),
            status: a.status // Keep status for debugging
          }))
          
          console.log('Mapped approval records (including editor):', mappedApprovals)
          
          // Check if editor's record is present
          const editorRecord = mappedApprovals.find((a: any) => a.user_id === editorId)
          console.log('Editor record found:', editorRecord)

          setAllSessionApprovals(mappedApprovals.map((a: any) => ({
            user_id: a.user_id,
            old_amount: a.old_amount,
            new_amount: a.new_amount
          })))
        } else {
          console.log('No approval records found for session', viewingSessionId)
          setAllSessionApprovals([])
          setEditorUserId(null)
        }
      }
      fetchAllApprovals()
    } else {
      setAllSessionApprovals([])
      setEditorUserId(null)
    }
  }, [viewingSessionId])

  // When a session row expands (including jumping here from the Dues tab's
  // Review/View buttons), scroll it into view since the list can be long.
  useEffect(() => {
    if (viewingSessionId === null) return
    const row = document.getElementById(`session-row-${viewingSessionId}`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [viewingSessionId])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showMemberDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('.member-dropdown-container')) {
          setShowMemberDropdown(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMemberDropdown])


  const handlePayDue = async (dueId: number) => {
    // Note: Your schema doesn't have a 'paid' field
    // You might want to add this field to SessionPayment table
    // For now, we'll just remove it from the list or mark it locally
    try {
      // Since there's no paid field, we'll just remove it from the list
      // Or you could add a 'paid' boolean column to SessionPayment
      setDues(dues.filter(due => due.id !== dueId))
      showToast('Due marked as paid (removed from list)')
    } catch (error) {
      console.error('Error paying due:', error)
      showToast('Failed to mark due as paid')
    }
  }

  const handleCopyPin = async () => {
    if (!group?.pin) return

    try {
      await navigator.clipboard.writeText(group.pin)
      showToast('Group pin copied to clipboard!')
    } catch (error) {
      console.error('Failed to copy pin:', error)
      showToast('Failed to copy pin. Please copy it manually.')
    }
  }

  // Both run server-side (approve_join_request / reject_join_request), since
  // adding someone else to GroupMember isn't something the owner's own RLS
  // permissions allow directly — see add_join_requests.sql.
  const handleApproveJoinRequest = guard(
    (requestId: number) => `approveJoinRequest:${requestId}`,
    async (requestId: number) => {
    try {
      const { error } = await supabase.rpc('approve_join_request', { request_id: requestId })
      if (error) throw error

      setPendingJoinRequests(prev => prev.filter(r => r.id !== requestId))
      await loadMembers()
      showToast('Request approved. they now have access to the group.')
    } catch (error: any) {
      console.error('Error approving join request:', error)
      showToast('Failed to approve request: ' + (error.message || 'Unknown error'))
    }
    }
  )

  const handleRejectJoinRequest = guard(
    (requestId: number) => `rejectJoinRequest:${requestId}`,
    async (requestId: number) => {
    try {
      const { error } = await supabase.rpc('reject_join_request', { request_id: requestId })
      if (error) throw error

      setPendingJoinRequests(prev => prev.filter(r => r.id !== requestId))
      showToast('Request rejected.')
    } catch (error: any) {
      console.error('Error rejecting join request:', error)
      showToast('Failed to reject request: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Runs server-side (remove_group_member) — it re-checks the $0 balance rule
  // itself rather than trusting the client, and flips status to 'removed'
  // instead of deleting the row, so their session/payment history is untouched.
  const handleRemoveMember = guard(
    (targetUserId: number) => `removeMember:${targetUserId}`,
    async (targetUserId: number) => {
    if (!groupId) return

    try {
      const { error } = await supabase.rpc('remove_group_member', {
        target_group_id: groupId,
        target_user_id: targetUserId,
      })

      if (error) throw error

      setConfirmRemoveMemberId(null)
      await loadMembers()
      showToast('Member removed.')
    } catch (error: any) {
      console.error('Error removing member:', error)
      showToast('Failed to remove member: ' + (error.message || 'Unknown error'))
    }
    }
  )

  // Runs server-side (leave_group) — it re-checks the $0 balance rule and
  // that you're not the owner itself rather than trusting the client, same
  // as remove_group_member above. The difference is it's self-scoped: no
  // target_user_id, the RPC always acts on whoever's calling it.
  const handleLeaveGroup = async () => {
    if (!groupId || leavingGroup) return

    setLeavingGroup(true)
    try {
      const { error } = await supabase.rpc('leave_group', {
        target_group_id: groupId,
      })

      if (error) throw error

      showToast('You left the group.')
      router.push('/')
    } catch (error: any) {
      console.error('Error leaving group:', error)
      showToast('Failed to leave group: ' + (error.message || 'Unknown error'))
      setConfirmLeaveGroup(false)
    } finally {
      setLeavingGroup(false)
    }
  }

  // The group settings actions below (rename/description, pin, delete,
  // transfer ownership) all run through owner-gated RPCs — see
  // 20260811000003_add_group_settings.sql and its follow-ups — rather than
  // a plain table update, since these are the one corner of the app where
  // membership alone isn't enough and it has to actually be the owner.

  const handleSaveGroupDetails = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!groupId || savingGroupDetails) return

    const trimmedName = groupNameDraft.trim()
    if (!trimmedName) {
      showToast('Group name cannot be empty')
      return
    }

    setSavingGroupDetails(true)
    try {
      const { error } = await supabase.rpc('update_group_details', {
        target_group_id: groupId,
        new_name: trimmedName,
        new_description: groupDescriptionDraft.trim() || null,
      })

      if (error) throw error

      await loadGroup()
      showToast('Group details saved.')
    } catch (error: any) {
      console.error('Error saving group details:', error)
      showToast('Failed to save group details: ' + (error.message || 'Unknown error'))
    } finally {
      setSavingGroupDetails(false)
    }
  }

  // Picking a file just opens BannerCropModal so the owner can choose how it
  // fits the banner strip by hand. That doesn't save right away either — it
  // just stages a value (pendingBannerValue) and opens the approve popup
  // below, so nothing actually lands on Group.banner_url until the owner
  // explicitly confirms the preview. handleApproveBanner is the one place
  // that actually calls update_group_banner — see
  // 20260811000008_add_group_banner.sql for why this needs its own
  // owner-gated RPC rather than a plain table update.
  const handleBannerFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return
    setBannerError('')
    setPendingBannerFile(file)
  }

  const handleBannerCropConfirm = (dataUrl: string) => {
    setPendingBannerFile(null)
    setBannerError('')
    setPendingBannerValue(dataUrl)
  }

  const handleCancelPendingBanner = () => {
    setPendingBannerValue(null)
    setBannerError('')
  }

  const handleApproveBanner = async () => {
    if (!pendingBannerValue || !groupId || uploadingBanner) return
    setBannerError('')
    setUploadingBanner(true)
    try {
      const { error } = await supabase.rpc('update_group_banner', {
        target_group_id: groupId,
        new_banner_url: pendingBannerValue,
      })
      if (error) throw error
      setGroup((prev) => (prev ? { ...prev, banner_url: pendingBannerValue } : prev))
      showToast('Group banner updated')
      setPendingBannerValue(null)
    } catch (err: any) {
      // Left set on failure (rather than cleared) so the popup stays open
      // with the preview still up — the owner can just hit Save again.
      setBannerError(err instanceof Error ? err.message : (err?.message || 'Failed to update banner'))
    } finally {
      setUploadingBanner(false)
    }
  }

  const handleRemoveBanner = async () => {
    if (!groupId || uploadingBanner) return
    setConfirmRemoveBanner(false)
    setBannerError('')
    setUploadingBanner(true)
    try {
      const { error } = await supabase.rpc('update_group_banner', {
        target_group_id: groupId,
        new_banner_url: null,
      })
      if (error) throw error
      setGroup((prev) => (prev ? { ...prev, banner_url: null } : prev))
      showToast('Group banner removed')
    } catch (err: any) {
      setBannerError(err instanceof Error ? err.message : (err?.message || 'Failed to remove banner'))
    } finally {
      setUploadingBanner(false)
    }
  }

  const handleRegeneratePin = async () => {
    if (!groupId || pinActionLoading) return
    setPinActionLoading(true)
    try {
      const { error } = await supabase.rpc('regenerate_group_pin', { target_group_id: groupId })
      if (error) throw error
      await loadGroup()
      setShowPin(true)
      showToast('New join pin generated.')
    } catch (error: any) {
      console.error('Error regenerating pin:', error)
      showToast('Failed to regenerate pin: ' + (error.message || 'Unknown error'))
    } finally {
      setPinActionLoading(false)
    }
  }

  const handleTogglePinEnabled = async (enabled: boolean) => {
    if (!groupId || pinActionLoading) return
    setPinActionLoading(true)
    try {
      const { error } = await supabase.rpc('set_group_pin_enabled', { target_group_id: groupId, enabled })
      if (error) throw error
      await loadGroup()
      showToast(enabled ? 'Join pin enabled.' : 'Join pin disabled. no one can join with it until you re-enable it.')
    } catch (error: any) {
      console.error('Error updating pin status:', error)
      showToast('Failed to update pin: ' + (error.message || 'Unknown error'))
    } finally {
      setPinActionLoading(false)
    }
  }

  const handleDeleteGroup = async () => {
    if (!groupId || deletingGroup) return
    setDeletingGroup(true)
    try {
      const { error } = await supabase.rpc('delete_group', { target_group_id: groupId })
      if (error) throw error
      showToast('Group deleted.')
      router.push('/')
    } catch (error: any) {
      console.error('Error deleting group:', error)
      showToast('Failed to delete group: ' + (error.message || 'Unknown error'))
      setDeletingGroup(false)
    }
  }

  const handleTransferOwnership = async () => {
    if (!groupId || !transferTargetUserId || transferringOwnership) return
    setTransferringOwnership(true)
    try {
      const { error } = await supabase.rpc('transfer_group_ownership', {
        target_group_id: groupId,
        new_owner_user_id: transferTargetUserId,
      })
      if (error) throw error

      setShowTransferConfirm(false)
      setTransferTargetUserId(null)
      await checkOwnership()
      await loadMembers()
      setActiveTab('dues')
      showToast('Ownership transferred.')
    } catch (error: any) {
      console.error('Error transferring ownership:', error)
      showToast('Failed to transfer ownership: ' + (error.message || 'Unknown error'))
    } finally {
      setTransferringOwnership(false)
    }
  }

  // Runs server-side (update_session_notes) — it re-checks that you're the
  // session's creator itself rather than trusting the client, since the
  // general "any member can update a session" rule doesn't apply to notes.
  const handleSaveNotes = async (sessionId: number) => {
    if (savingNotes) return
    setSavingNotes(true)
    try {
      const { error } = await supabase.rpc('update_session_notes', {
        target_session_id: sessionId,
        new_notes: notesDraft.trim() || null,
      })

      if (error) throw error

      setEditingNotesSessionId(null)
      await loadSessions()
      showToast('Notes saved.')
    } catch (error: any) {
      console.error('Error saving notes:', error)
      showToast('Failed to save notes: ' + (error.message || 'Unknown error'))
    } finally {
      setSavingNotes(false)
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen">
        <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="w-9 h-9 rounded-full" />
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col gap-6 md:flex-row md:gap-0">
          <aside className="md:w-56 flex-shrink-0 md:border-r md:pr-6 md:mr-6" style={{ borderColor: 'var(--border)' }}>
            <nav className="flex flex-row md:flex-col gap-1.5 overflow-x-auto md:overflow-visible">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 rounded-md shrink-0" style={{ width: 130 }} />
              ))}
            </nav>
          </aside>

          <div className="flex-1">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-7 w-24 mb-6" />

            <div className="card mb-8 flex items-center justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-9 w-28" />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {[0, 1].map((col) => (
                <div key={col} className="card space-y-3">
                  <Skeleton className="h-3 w-28 mb-1" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (!group) {
    return null
  }

  // Calculate net balance: sum of all session payments for the current user
  // Positive = user is owed money, Negative = user owes money
  const netBalance = userId 
    ? dues
        .filter(d => d.user_id === userId)
        .reduce((sum, d) => sum + d.amount, 0)
    : 0

  // Members currently in the group — removed members keep their row (and every
  // SessionPayment they were ever part of) so old sessions still show their real
  // name, but they no longer count as "in" the group anywhere active.
  const activeMembers = members.filter(m => m.status !== 'removed')

  // Calculate net balance for all members
  // Positive = user is owed money, Negative = user owes money
  const memberBalances = activeMembers.map(member => {
    const balance = dues
      .filter(d => d.user_id === member.user_id)
      .reduce((sum, d) => sum + d.amount, 0)
    return {
      ...member,
      balance
    }
  }).sort((a, b) => b.balance - a.balance) // owed money first, those who owe last

  // Deleting doesn't require everyone to be settled up first (unlike leaving
  // or being removed) — but if anyone still has a balance, that money just
  // disappears along with the group, so the confirm flow below routes
  // through an extra warning instead of deleting outright.
  const hasUnsettledBalances = memberBalances.some(m => Math.abs(m.balance) >= 1)

  const handleDeleteGroupConfirmClick = () => {
    if (hasUnsettledBalances) {
      setShowDeleteGroupConfirm(false)
      setShowDeleteBalanceWarning(true)
    } else {
      handleDeleteGroup()
    }
  }

  const tabs: Array<{ key: typeof activeTab; label: string }> = [
    { key: 'dues', label: 'Dues' },
    { key: 'members', label: 'Group Members' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'info', label: group.name ? `${group.name} Info` : 'Group Info' },
  ]

  // The content shown when a session row is expanded inline (not a separate
  // view — the row itself toggles this open/closed, accordion-style).
  const renderSessionExpansion = (
    session: Session,
    pendingApproval: typeof pendingApprovals[number] | undefined,
    pendingRejection: typeof pendingRejections[number] | undefined,
    hasUndismissedRejection: unknown
  ) => {
    // Rejection notice — the editor is reviewing why their change was turned down.
    if (pendingRejection && hasUndismissedRejection) {
      return (
        <div className="card rounded-l-none" style={{ borderLeftWidth: 4, borderLeftColor: 'var(--negative)' }}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <XCircle size={18} style={{ color: 'var(--negative)' }} />
              {pendingRejection.is_deletion ? 'Deletion request rejected' : 'Session edit rejected'}
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {pendingRejection.is_deletion
                ? 'Your request to delete this session was rejected. it was kept as-is.'
                : 'Your edit to this session was rejected.'}
            </p>
          </div>

          <div className="space-y-2 mb-4">
            <div className="ledger-row">
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Rejected by</span>
              <span className="font-medium text-sm">
                {pendingRejection.approver_name || 'Unknown'}
              </span>
            </div>
            {pendingRejection.rejected_at && (
              <div className="ledger-row">
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Rejected on</span>
                <span className="text-sm">
                  {new Date(pendingRejection.rejected_at).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {pendingRejection.rejection_reason && (
            <div className="mb-4">
              <p className="eyebrow mb-1">Reason</p>
              <p className="text-sm whitespace-pre-wrap">{pendingRejection.rejection_reason}</p>
            </div>
          )}

          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {pendingRejection.is_deletion
              ? 'You can request deletion again if needed.'
              : sessionDetails.length === 0
                ? 'This will be removed once you close this notice.'
                : 'You can edit the session again if needed.'}
          </p>

          <button
            onClick={async () => {
              if (pendingRejection) {
                try {
                  console.log('Dismissing rejection:', pendingRejection.id)

                  // Mark rejection as dismissed in the database
                  const { data: updatedData, error: dismissError } = await supabase
                    .from('SessionEditApproval')
                    .update({ dismissed_at: new Date().toISOString() })
                    .eq('id', pendingRejection.id)
                    .select()

                  console.log('Dismiss update result:', { updatedData, dismissError })

                  // If column doesn't exist, delete the rejection record instead
                  if (dismissError && (dismissError.message?.includes('dismissed_at') || dismissError.message?.includes('column'))) {
                    console.log('dismissed_at column doesn\'t exist, deleting rejection record instead')
                    const { error: deleteError } = await supabase
                      .from('SessionEditApproval')
                      .delete()
                      .eq('id', pendingRejection.id)

                    if (deleteError) {
                      console.error('Error deleting rejection:', deleteError)
                      showToast('Failed to dismiss rejection. Please try again.')
                      return
                    }
                  } else if (dismissError) {
                    console.error('Error dismissing rejection:', dismissError)
                    showToast('Failed to dismiss rejection. Please try again.')
                    return
                  }

                  // A rejected proposal that never had any real SessionPayment rows
                  // (a brand-new payment or session, not an edit to an existing one —
                  // see the matching sessionDetails.length check in the copy above)
                  // has nothing worth keeping around now that the editor has seen why
                  // it was rejected. Clean up the session and its approval trail so it
                  // disappears for the editor too, matching how it already disappeared
                  // for the rejector the moment they rejected it. Deletion requests are
                  // the opposite case — rejecting one means "keep the session" — so
                  // those are excluded here.
                  if (!pendingRejection.is_deletion && sessionDetails.length === 0) {
                    await supabase.from('SessionEditApproval').delete().eq('session_id', session.id)
                    await supabase.from('Session').delete().eq('id', session.id)
                  }

                  // Close the expanded row immediately
                  setViewingSessionId(null)

                  // Remove from pendingRejections state immediately for better UX
                  setPendingRejections(prev => prev.filter(pr => pr.id !== pendingRejection.id))

                  // Reload sessions and pending approvals to update the UI
                  // (this also refreshes pendingRejections/pendingApprovals/pendingCancellations,
                  // which is what the Dues tab's Pending Actions area renders from)
                  await loadSessions()
                  await loadPendingApprovals()
                } catch (error: any) {
                  console.error('Error dismissing rejection:', error)
                  showToast('Failed to dismiss rejection: ' + (error.message || 'Unknown error'))
                }
              }
            }}
            className="btn-secondary w-full"
          >
            OK
          </button>
        </div>
      )
    }

    // Approval needed — someone else's change (or a deletion) is waiting on this member.
    if (pendingApproval && session.pendingApproval) {
      return (
        <div className="card rounded-l-none" style={{ borderLeftWidth: 4, borderLeftColor: 'var(--accent)' }}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <TriangleAlert size={18} style={{ color: 'var(--accent)' }} />
              {pendingApproval?.is_deletion ? 'Deletion request pending' : 'Pending approval required'}
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {pendingApproval?.is_deletion
                ? 'A group member wants to delete this session. every amount below is going to $0.'
                : isSettleUpDescription(session.Description)
                  ? 'A group member started a settle up. Review the changes below.'
                  : session.is_payment
                    ? 'A group member recorded a payment. Review the changes below.'
                    : 'This session has been edited. Review the changes below.'}
            </p>
            {session.is_payment && session.payment_method && (
              <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <PaymentMethodIcon method={session.payment_method} size={14} />
                Paid via <span className="font-medium">{paymentMethodLabel(session.payment_method)}</span>
              </p>
            )}
          </div>

          <div className="mb-4">
            {/* Show all members' changes */}
            <div className="mb-4">
              <p className="eyebrow mb-2">All changes</p>
              <div>
                {(() => {
                  // Combine all members: those with approval records and those in current session
                  const allMemberIds = new Set<number>()

                  // Add all members who have approval records (they have changes)
                  allSessionApprovals.forEach(a => {
                    allMemberIds.add(a.user_id)
                  })

                  // Add all members currently in the session
                  sessionDetails.forEach(d => {
                    allMemberIds.add(d.user_id)
                  })

                  // Editor's change is now included in allSessionApprovals (with status 'approved')
                  // No need to calculate it separately

                  // Create a combined list showing all members
                  const allMembersToShow = Array.from(allMemberIds).map(memberUserId => {
                    const approvalRecord = allSessionApprovals.find(a => a.user_id === memberUserId)
                    const sessionDetail = sessionDetails.find(d => d.user_id === memberUserId)
                    const member = members.find(m => m.user_id === memberUserId)

                    // If there's an approval record, show the change (old → new)
                    // Otherwise, show the current amount
                    const hasChange = !!approvalRecord

                    return {
                      user_id: memberUserId,
                      displayName: member ? formatDisplayName(members, member) : (sessionDetail?.username || 'Unknown'),
                      isCurrentUser: memberUserId === userId,
                      approvalRecord,
                      currentAmount: sessionDetail?.amount || approvalRecord?.new_amount || 0,
                      hasChange
                    }
                  })

                  if (allMembersToShow.length === 0) {
                    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading session details...</p>
                  }

                  return allMembersToShow.map((memberInfo) => {
                    const isCurrentUser = memberInfo.user_id === userId

                    return (
                      <div key={memberInfo.user_id} className="ledger-row">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {memberInfo.displayName}
                          </span>
                          {isCurrentUser && <span className="badge badge-accent">You</span>}
                        </div>
                        <div className="flex items-center gap-2 amount">
                          {memberInfo.approvalRecord ? (
                            <>
                              <span
                                className="text-sm font-medium"
                                style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}
                              >
                                {memberInfo.approvalRecord.old_amount >= 0 ? '+' : ''}${memberInfo.approvalRecord.old_amount.toFixed(2)}
                              </span>
                              <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                              <span
                                className="text-sm font-semibold"
                                style={{ color: memberInfo.approvalRecord.new_amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                              >
                                {memberInfo.approvalRecord.new_amount >= 0 ? '+' : ''}${memberInfo.approvalRecord.new_amount.toFixed(2)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span
                                className="text-sm font-semibold"
                                style={{ color: memberInfo.currentAmount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                              >
                                {memberInfo.currentAmount >= 0 ? '+' : ''}${memberInfo.currentAmount.toFixed(2)}
                              </span>
                              {memberInfo.currentAmount !== 0 && (
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(no change)</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleApproveEdit(pendingApproval.id, session.id)}
              disabled={isBusy(`approveEdit:${pendingApproval.id}`)}
              className="btn-approve flex-1 py-3"
            >
              <Check size={18} /> {pendingApproval?.is_deletion ? 'Approve deletion' : 'Approve'}
            </button>
            <button
              onClick={() => {
                setRejectReasonDraft('')
                setRejectingApproval({
                  approvalId: pendingApproval.id,
                  sessionId: session.id,
                  editorUserId: pendingApproval.editor_user_id,
                  isDeletion: pendingApproval?.is_deletion,
                })
              }}
              className="btn-reject flex-1 py-3"
            >
              <X size={18} /> {pendingApproval?.is_deletion ? 'Keep session' : 'Reject'}
            </button>
          </div>
        </div>
      )
    }

    // Normal case — notes plus the member payment breakdown. Everything else
    // (edit / delete / cancel-edit) already lives in the row header above.
    const canEditNotes = session.created_by == null || session.created_by === userId
    const isEditingNotes = editingNotesSessionId === session.id

    return (
      <>
        {session.is_payment && session.payment_method && (
          <p className="text-sm mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <PaymentMethodIcon method={session.payment_method} size={14} />
            Paid via <span className="font-medium">{paymentMethodLabel(session.payment_method)}</span>
          </p>
        )}
        {isEditingNotes ? (
          <div className="mb-6">
            <p className="eyebrow mb-2">Notes</p>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              className="field"
              rows={3}
              placeholder="Add a note about this session…"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => handleSaveNotes(session.id)}
                disabled={savingNotes}
                className="btn-primary text-sm"
              >
                {savingNotes ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEditingNotesSessionId(null)}
                disabled={savingNotes}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (session.notes || canEditNotes) && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <p className="eyebrow">Notes</p>
              {canEditNotes && (
                <button
                  onClick={() => {
                    setNotesDraft(session.notes || '')
                    setEditingNotesSessionId(session.id)
                  }}
                  className="text-xs font-medium hover:underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {session.notes ? 'Edit' : 'Add notes'}
                </button>
              )}
            </div>
            {session.notes ? (
              <p className="text-sm whitespace-pre-wrap">{session.notes}</p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No notes yet.</p>
            )}
          </div>
        )}

        <div>
          <p className="eyebrow mb-3">Member payments</p>
          {sessionDetails.length === 0 && allSessionApprovals.length > 0 ? (
            // Nothing has landed in SessionPayment yet — this is a just-created
            // payment still waiting on the other side to confirm (see
            // handleMakePayment/handleApproveEdit). Show the proposed amounts
            // from the approval records instead of falsely claiming there are
            // no payments.
            <>
              <p className="text-sm mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <Hourglass size={14} />
                Not final yet. waiting for confirmation.
              </p>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {allSessionApprovals.map((approval) => {
                  const member = members.find(m => m.user_id === approval.user_id)
                  const displayName = member ? formatDisplayName(members, member) : 'Unknown'
                  return (
                    <div key={approval.user_id} className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3">
                        <Avatar url={member?.avatar_url} name={displayName} size={32} />
                        <p className="font-medium text-sm">{displayName}</p>
                      </div>
                      <p
                        className="amount text-lg font-semibold"
                        style={{ color: approval.new_amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                      >
                        {approval.new_amount >= 0 ? '+' : ''}${approval.new_amount.toFixed(2)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </>
          ) : sessionDetails.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No payments in this session.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {sessionDetails.map((detail) => {
                const member = members.find(m => m.user_id === detail.user_id)
                const displayName = member ? formatDisplayName(members, member) : detail.username
                return (
                  <div key={detail.user_id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <Avatar url={member?.avatar_url} name={displayName} size={32} />
                      <div>
                        <p className="font-medium text-sm">{displayName}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{detail.username}</p>
                      </div>
                    </div>
                    <p
                      className="amount text-lg font-semibold"
                      style={{ color: detail.amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                    >
                      {detail.amount >= 0 ? '+' : ''}${detail.amount.toFixed(2)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <main className="min-h-screen">
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-sm font-medium hover:underline flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={16} /> Back
          </Link>
          <h1 className="font-display text-xl font-semibold tracking-tight">{group.name || 'Untitled Group'}</h1>
          <AuthPanel />
        </div>
      </header>

      {group.banner_url && (
        <div className="max-w-7xl mx-auto px-6 pt-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not worth next/image's optimizer here */}
          <img
            src={group.banner_url}
            alt=""
            className="w-full rounded-xl object-cover"
            style={{ height: 160, border: '1px solid var(--border)' }}
          />
        </div>
      )}

      <div className={`max-w-7xl mx-auto px-6 pb-8 flex flex-col gap-6 md:flex-row md:gap-0 ${group.banner_url ? 'pt-6' : 'pt-8'}`}>
        {/* Sidebar — split from the content by a hairline, the same way the
            topbar is split from the page, rather than boxing it in a panel. */}
        <aside className="md:w-56 flex-shrink-0 md:border-r md:pr-6 md:mr-6" style={{ borderColor: 'var(--border)' }}>
          <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={activeTab === t.key ? 'tab-item-active whitespace-nowrap' : 'tab-item whitespace-nowrap'}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <div className="flex-1">
          {activeTab === 'dues' && (
            <div className="mb-6">
              <div className="flex items-center justify-between gap-4 mb-6">
                <h2 className="font-display text-2xl font-semibold">Dues</h2>
                <button
                  onClick={openSettleBalanceModal}
                  className="btn-primary shrink-0"
                  disabled={Math.abs(netBalance) < 1}
                  title={Math.abs(netBalance) < 1 ? "You're already settled up" : undefined}
                >
                  Settle your balance
                </button>
              </div>

              {/* Your balance */}
              <div className="card mb-8 flex items-center justify-between gap-4">
                <div>
                  <p className="eyebrow mb-1 flex items-center gap-1.5">
                    Your balance
                    <InfoTooltip label="What this balance means">
                      A positive balance means the group owes you money; negative means you owe the
                      group. Recording a payment moves both numbers toward zero. it never moves money itself.
                    </InfoTooltip>
                  </p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {netBalance > 0 ? "You're owed money" : netBalance < 0 ? 'You owe money' : "You're settled up"}
                  </p>
                </div>
                <p
                  className="amount text-4xl font-semibold"
                  style={{ color: netBalance > 0 ? 'var(--accent)' : netBalance < 0 ? 'var(--negative)' : 'var(--text)' }}
                >
                  {netBalance >= 0 ? '+' : ''}${(netBalance / 100).toFixed(2)}
                </p>
              </div>

              {/* Pending approval (left) & Notifications (right) — split screen under the balance */}
              {(() => {
                const inFlight = sessions
                  .filter((s) => s.pendingApproval || s.waitingForApproval)
                  .sort((a, b) => (a.pendingApproval === b.pendingApproval ? 0 : a.pendingApproval ? -1 : 1))

                const notificationCount = pendingRejections.length + pendingCancellations.length + pendingRejectionNotices.length

                return (
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Pending approval — any session/payment currently mid-edit: either
                        you need to review it, or you're the editor waiting on everyone else. */}
                    <div>
                      <p className="eyebrow mb-3">Pending approval</p>
                      {inFlight.length === 0 ? (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing pending.</p>
                      ) : (
                        <div className="space-y-2">
                          {inFlight.map((s) => (
                            <div
                              key={`inflight-${s.id}`}
                              className="flex items-center justify-between gap-4 rounded-lg border p-4"
                              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                            >
                              <div className="flex items-center gap-3">
                                <span style={{ color: s.pendingApproval ? 'var(--accent)' : 'var(--text-muted)' }}>
                                  {s.pendingApproval ? <TriangleAlert size={18} /> : <Hourglass size={18} />}
                                </span>
                                <div>
                                  <p className="text-sm font-medium">
                                    {s.Description || 'Untitled Session'}
                                  </p>
                                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    {s.pendingApproval
                                      ? s.pendingIsDeletion ? 'Someone wants to delete this. needs your review' : 'Needs your review'
                                      : s.pendingIsDeletion ? 'Waiting on others to approve deleting this' : 'Waiting on others to approve your changes'}
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setActiveTab('sessions')
                                  setViewingSessionId(s.id)
                                }}
                                className={s.pendingApproval ? 'btn-primary text-sm shrink-0' : 'btn-secondary text-sm shrink-0'}
                              >
                                {s.pendingApproval ? 'Review' : 'View'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Notifications — resolved edits that still need acknowledging:
                        your edit got rejected, your review got cancelled by the editor,
                        or an edit you were reviewing got rejected by someone else. */}
                    <div>
                      <p className="eyebrow mb-3">Notifications</p>
                      {notificationCount === 0 ? (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No notifications.</p>
                      ) : (
                        <div className="space-y-2">
                          {pendingRejections.map((pr) => (
                            <div
                              key={`rejection-${pr.id}`}
                              className="flex items-center justify-between gap-4 rounded-lg border p-4"
                              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                            >
                              <div className="flex items-center gap-3">
                                <XCircle size={18} style={{ color: 'var(--negative)' }} />
                                <p className="text-sm font-medium">
                                  {pr.is_deletion
                                    ? <>Your request to delete &ldquo;{pr.session_description}&rdquo; was rejected by {pr.approver_name || 'a member'}</>
                                    : <>Your edit to &ldquo;{pr.session_description}&rdquo; was rejected by {pr.approver_name || 'a member'}</>}
                                </p>
                              </div>
                              <button
                                onClick={() => {
                                  setActiveTab('sessions')
                                  setViewingSessionId(pr.session_id)
                                }}
                                className="btn-danger text-sm shrink-0"
                              >
                                Review
                              </button>
                            </div>
                          ))}
                          {pendingRejectionNotices.map((rn) => (
                            <div
                              key={`rejection-notice-${rn.id}`}
                              className="flex items-center justify-between gap-4 rounded-lg border p-4"
                              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                            >
                              <div className="flex items-center gap-3">
                                <XCircle size={18} style={{ color: 'var(--text-muted)' }} />
                                <p className="text-sm font-medium">
                                  {rn.is_deletion
                                    ? <>The request to delete &ldquo;{rn.session_description}&rdquo; was rejected by {rn.rejected_by_name || 'a member'}. it was kept</>
                                    : <>&ldquo;{rn.session_description}&rdquo; was rejected by {rn.rejected_by_name || 'a member'}. the edit did not go through</>}
                                </p>
                              </div>
                              <button
                                onClick={() => handleDismissRejectionNotice(rn.id)}
                                disabled={isBusy(`dismissRejectionNotice:${rn.id}`)}
                                className="btn-secondary text-sm shrink-0"
                              >
                                Dismiss
                              </button>
                            </div>
                          ))}
                          {pendingCancellations.map((pc) => (
                            <div
                              key={`cancel-${pc.id}`}
                              className="flex items-center justify-between gap-4 rounded-lg border p-4"
                              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                            >
                              <div className="flex items-center gap-3">
                                <Undo2 size={18} style={{ color: 'var(--text-muted)' }} />
                                <p className="text-sm font-medium">
                                  {pc.is_deletion
                                    ? <>The request to delete &ldquo;{pc.session_description}&rdquo; was cancelled. your review is no longer needed</>
                                    : <>Your review on &ldquo;{pc.session_description}&rdquo; was cancelled by the editor</>}
                                </p>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button
                                  onClick={() => {
                                    setActiveTab('sessions')
                                    setViewingSessionId(pc.session_id)
                                  }}
                                  className="btn-secondary text-sm"
                                >
                                  View
                                </button>
                                <button
                                  onClick={() => handleDismissCancellation(pc.id)}
                                  disabled={isBusy(`dismissCancellation:${pc.id}`)}
                                  className="btn-secondary text-sm"
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}

              {showSettleBalanceModal && (() => {
                const direction: 'pay' | 'receive' = netBalance < 0 ? 'pay' : 'receive'
                const validLegs = settleBalanceLegs.filter(leg => settleBalanceLegCents(leg) > 0)
                const totalCents = settleBalanceTotalCents(validLegs)
                const remaining = netBalance + (direction === 'pay' ? totalCents : -totalCents)
                const isSettled = remaining === 0
                const canSubmit = isSettled && validLegs.length > 0

                return (
                  <div className="modal-overlay">
                    <div className="modal-panel">
                      <h3 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
                        Settle your balance
                        <InfoTooltip label="How this affects balances">
                          This creates one session that zeroes out just your balance below, the
                          same way recording a payment does. Split it across as many people as
                          you like below — it just has to add up to your balance landing on
                          $0.00. It won&apos;t change anyone&apos;s balance until they confirm —
                          that way no one can clear a debt they still owe by just claiming it&apos;s
                          settled.
                        </InfoTooltip>
                      </h3>

                      <p className="eyebrow mb-2">Balances</p>
                      <div className="divide-y mb-4" style={{ borderColor: 'var(--border)' }}>
                        {memberBalances.map((member) => {
                          const memberRemaining = settleBalanceRemaining(member, direction, validLegs)
                          const isMemberZero = memberRemaining === 0
                          return (
                            <div key={member.user_id} className="flex items-center justify-between gap-4 py-3">
                              <div className="flex items-center gap-3">
                                <Avatar url={member.avatar_url} name={formatDisplayName(members, member)} size={32} />
                                <p className="text-sm font-medium">
                                  {member.user_id === userId ? 'You' : formatDisplayName(members, member)}
                                </p>
                              </div>
                              <p
                                className="amount text-sm font-semibold"
                                style={{
                                  color: isMemberZero
                                    ? 'var(--text-muted)'
                                    : memberRemaining > 0 ? 'var(--accent)' : 'var(--negative)',
                                }}
                              >
                                {memberRemaining >= 0 ? '+' : ''}${(memberRemaining / 100).toFixed(2)}
                              </p>
                            </div>
                          )
                        })}
                      </div>

                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="eyebrow">{direction === 'pay' ? 'Who you pay' : 'Who pays you'}</p>
                        <button
                          type="button"
                          onClick={resetSettleBalanceLegsToSuggested}
                          className="text-xs font-medium hover:underline shrink-0"
                          style={{ color: 'var(--accent)' }}
                        >
                          Reset to suggested
                        </button>
                      </div>
                      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                        These are the real payments members will make (Venmo, cash, etc).
                        Edit, remove, or add rows until your balance above reads $0.00.
                      </p>

                      <div className="space-y-2 mb-2">
                        {settleBalanceLegs.map((leg) => (
                          <div key={leg.id} className="flex flex-wrap items-center gap-2">
                            <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                              {direction === 'pay' ? 'You pay' : 'Receive from'}
                            </span>
                            <select
                              value={leg.counterpartyId ?? ''}
                              onChange={(e) =>
                                updateSettleBalanceLeg(leg.id, { counterpartyId: e.target.value ? Number(e.target.value) : null })
                              }
                              className="field text-sm flex-1 min-w-0"
                              aria-label={direction === 'pay' ? 'Who you pay' : 'Who pays you'}
                            >
                              <option value="" disabled>Select a member</option>
                              {activeMembers
                                .filter(m => m.user_id !== userId)
                                .map((m) => (
                                  <option key={m.user_id} value={m.user_id}>
                                    {formatDisplayName(members, m)}
                                  </option>
                                ))}
                            </select>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={leg.amount}
                              onChange={(e) => updateSettleBalanceLeg(leg.id, { amount: e.target.value })}
                              onWheel={blockNumberScroll}
                              placeholder="0.00"
                              aria-label="Amount"
                              className="field amount text-sm shrink-0"
                              style={{ width: '6.5rem' }}
                            />
                            <button
                              type="button"
                              onClick={() => removeSettleBalanceLeg(leg.id)}
                              className="shrink-0 text-sm"
                              style={{ color: 'var(--text-muted)' }}
                              aria-label="Remove payment"
                              title="Remove payment"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={addSettleBalanceLeg}
                        className="text-xs font-medium hover:underline mb-4"
                        style={{ color: 'var(--accent)' }}
                      >
                        + Add payment
                      </button>

                      {!isSettled && (
                        <p className="text-xs mb-4" style={{ color: 'var(--negative)' }}>
                          Adjust the payments above until your balance reaches $0.00.
                        </p>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handleSettleBalance}
                          disabled={isSubmittingSettleBalance || !canSubmit}
                          className="btn-primary flex-1"
                          title={canSubmit ? undefined : 'Adjust the payments so your balance reaches $0.00'}
                        >
                          {isSubmittingSettleBalance ? 'Requesting…' : 'Settle up'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowSettleBalanceModal(false)}
                          className="btn-secondary"
                          disabled={isSubmittingSettleBalance}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {activeTab === 'members' && (
            <div>
              <div className="flex items-center justify-between gap-4 mb-6">
                <h2 className="font-display text-2xl font-semibold">Group Members</h2>
                <button
                  onClick={openSettleUpModal}
                  className="btn-primary shrink-0"
                  disabled={!hasUnsettledBalances}
                  title={hasUnsettledBalances ? undefined : "Everyone's already settled up"}
                >
                  Settle up
                </button>
              </div>

              {isOwner && pendingJoinRequests.length > 0 && (
                <div className="mb-8">
                  <p className="eyebrow mb-3">Pending requests</p>
                  <div className="space-y-2">
                    {pendingJoinRequests.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between gap-4 rounded-lg border p-4"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar url={req.avatar_url} name={req.displayName} size={36} />
                          <div>
                            <p className="text-sm font-medium">{req.displayName}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{req.username} · wants to join</p>
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => handleApproveJoinRequest(req.id)} disabled={isBusy(`approveJoinRequest:${req.id}`)} className="btn-primary text-sm">
                            Approve
                          </button>
                          <button onClick={() => handleRejectJoinRequest(req.id)} disabled={isBusy(`rejectJoinRequest:${req.id}`)} className="btn-secondary text-sm">
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {memberBalances.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No members yet.</p>
              ) : (
                <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
                  {memberBalances.map((member) => {
                    const isCurrentUser = member.user_id === userId
                    const balance = member.balance
                    return (
                      <div
                        key={member.user_id}
                        className="flex items-center justify-between gap-4 py-5 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (isCurrentUser) {
                                router.push('/profile')
                                return
                              }
                              setProfileModalContext({})
                              setProfileModalUserId(member.user_id)
                            }}
                            title={isCurrentUser ? 'Edit your profile' : `View ${formatDisplayName(members, member)}'s profile`}
                          >
                            <Avatar url={member.avatar_url} name={formatDisplayName(members, member)} size={44} />
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isCurrentUser) {
                                    router.push('/profile')
                                    return
                                  }
                                  setProfileModalContext({})
                                  setProfileModalUserId(member.user_id)
                                }}
                                className="font-semibold hover:underline text-left"
                              >
                                {formatDisplayName(members, member)}
                              </button>
                              {isCurrentUser && <span className="badge badge-accent">You</span>}
                              {member.role === 'owner' && <span className="badge badge-outline">Owner</span>}
                            </div>
                            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>@{member.username}</p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                              Joined {new Date(member.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="eyebrow mb-1">Net balance</p>
                          <p
                            className="amount text-2xl font-semibold"
                            style={{
                              color: balance > 0 ? 'var(--accent)' : balance < 0 ? 'var(--negative)' : 'var(--text)',
                            }}
                          >
                            {balance >= 0 ? '+' : ''}${(balance / 100).toFixed(2)}
                          </p>
                          {balance > 0 && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Owed money</p>
                          )}
                          {balance < 0 && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Owes money</p>
                          )}
                          {balance === 0 && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Balanced</p>
                          )}
                          {isOwner && !isCurrentUser && member.role !== 'owner' && (
                            <button
                              onClick={() => setConfirmRemoveMemberId(member.user_id)}
                              disabled={Math.abs(balance) >= 1}
                              className="mt-2 text-xs font-medium hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:no-underline"
                              style={{ color: 'var(--negative)' }}
                              title={Math.abs(balance) >= 1 ? 'Balance must be $0.00 before they can be removed' : 'Remove from group'}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {confirmRemoveMemberId !== null && (() => {
                const target = members.find(m => m.user_id === confirmRemoveMemberId)
                return (
                  <div className="modal-overlay">
                    <div className="modal-panel">
                      <h3 className="font-display text-xl font-semibold mb-2">
                        Remove {target ? formatDisplayName(members, target) : 'this member'}?
                      </h3>
                      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                        They&apos;ll lose access right away, but their past sessions and payments stay untouched. They can request to rejoin later.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRemoveMember(confirmRemoveMemberId)}
                          disabled={isBusy(`removeMember:${confirmRemoveMemberId}`)}
                          className="btn-danger flex-1"
                        >
                          Remove member
                        </button>
                        <button onClick={() => setConfirmRemoveMemberId(null)} className="btn-secondary">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {showSettleUpModal && (() => {
                const unsettled = memberBalances.filter(m => Math.abs(m.balance) >= 1)
                const validLegs = settleUpLegs.filter(leg => settleUpLegCents(leg) > 0)
                const allSettled = memberBalances.every(
                  m => m.balance + settleUpNetCents(validLegs, m.user_id) === 0
                )
                const canSubmit = allSettled && validLegs.length > 0

                return (
                  <div className="modal-overlay">
                    <div className="modal-panel">
                      <h3 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
                        Settle up
                        <InfoTooltip label="How this affects balances">
                          This creates one session that zeroes out every balance below, the same
                          way recording a payment does. Reassign who pays whom below as needed —
                          it just has to add up to everyone landing on $0.00. It won&apos;t change
                          anyone&apos;s balance until they confirm — that way no one can clear a
                          debt they still owe by just claiming it&apos;s settled.
                        </InfoTooltip>
                      </h3>

                      {unsettled.length === 0 ? (
                        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                          Everyone&apos;s already settled up.
                        </p>
                      ) : (
                        <>
                          <p className="eyebrow mb-2">Balances</p>
                          <div className="divide-y mb-4" style={{ borderColor: 'var(--border)' }}>
                            {memberBalances.map((member) => {
                              const remaining = member.balance + settleUpNetCents(validLegs, member.user_id)
                              const isZero = remaining === 0
                              return (
                                <div key={member.user_id} className="flex items-center justify-between gap-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <Avatar url={member.avatar_url} name={formatDisplayName(members, member)} size={32} />
                                    <p className="text-sm font-medium">
                                      {member.user_id === userId ? 'You' : formatDisplayName(members, member)}
                                    </p>
                                  </div>
                                  <p
                                    className="amount text-sm font-semibold"
                                    style={{
                                      color: isZero
                                        ? 'var(--text-muted)'
                                        : remaining > 0 ? 'var(--accent)' : 'var(--negative)',
                                    }}
                                  >
                                    {remaining >= 0 ? '+' : ''}${(remaining / 100).toFixed(2)}
                                  </p>
                                </div>
                              )
                            })}
                          </div>

                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="eyebrow">Payments</p>
                            <button
                              type="button"
                              onClick={resetSettleUpLegsToSuggested}
                              className="text-xs font-medium hover:underline shrink-0"
                              style={{ color: 'var(--accent)' }}
                            >
                              Reset to suggested
                            </button>
                          </div>
                          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                            These are the real payments members will make (Venmo, cash, etc).
                            Each row moves the two balances above — edit, remove, or add rows
                            until every balance up top reads $0.00.
                          </p>

                          <div className="space-y-2 mb-2">
                            {settleUpLegs.map((leg) => (
                              <div key={leg.id} className="flex flex-wrap items-center gap-2">
                                <select
                                  value={leg.from ?? ''}
                                  onChange={(e) =>
                                    updateSettleUpLeg(leg.id, { from: e.target.value ? Number(e.target.value) : null })
                                  }
                                  className="field text-sm flex-1 min-w-0"
                                  aria-label="Who pays"
                                >
                                  <option value="" disabled>Who pays?</option>
                                  {activeMembers.map((m) => (
                                    <option key={m.user_id} value={m.user_id} disabled={m.user_id === leg.to}>
                                      {m.user_id === userId ? 'You' : formatDisplayName(members, m)}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                                  pays
                                </span>
                                <select
                                  value={leg.to ?? ''}
                                  onChange={(e) =>
                                    updateSettleUpLeg(leg.id, { to: e.target.value ? Number(e.target.value) : null })
                                  }
                                  className="field text-sm flex-1 min-w-0"
                                  aria-label="Who receives it"
                                >
                                  <option value="" disabled>Who receives?</option>
                                  {activeMembers.map((m) => (
                                    <option key={m.user_id} value={m.user_id} disabled={m.user_id === leg.from}>
                                      {m.user_id === userId ? 'You' : formatDisplayName(members, m)}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={leg.amount}
                                  onChange={(e) => updateSettleUpLeg(leg.id, { amount: e.target.value })}
                                  onWheel={blockNumberScroll}
                                  placeholder="0.00"
                                  aria-label="Amount"
                                  className="field amount text-sm shrink-0"
                                  style={{ width: '6.5rem' }}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeSettleUpLeg(leg.id)}
                                  className="shrink-0 text-sm"
                                  style={{ color: 'var(--text-muted)' }}
                                  aria-label="Remove payment"
                                  title="Remove payment"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={addSettleUpLeg}
                            className="text-xs font-medium hover:underline mb-4"
                            style={{ color: 'var(--accent)' }}
                          >
                            + Add payment
                          </button>

                          {!allSettled && (
                            <p className="text-xs mb-4" style={{ color: 'var(--negative)' }}>
                              Adjust the payments above until everyone&apos;s balance reaches $0.00.
                            </p>
                          )}
                        </>
                      )}

                      <div className="flex gap-2">
                        {unsettled.length > 0 && (
                          <button
                            onClick={handleSettleUp}
                            disabled={isSubmittingSettleUp || !canSubmit}
                            className="btn-primary flex-1"
                            title={canSubmit ? undefined : "Adjust the payments so every balance reaches $0.00"}
                          >
                            {isSubmittingSettleUp ? 'Requesting…' : 'Settle up'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowSettleUpModal(false)}
                          className="btn-secondary"
                          disabled={isSubmittingSettleUp}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}

            </div>
          )}

          {activeTab === 'sessions' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="font-display text-2xl font-semibold">Sessions</h2>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowMakePaymentModal(true)} className="btn-secondary">
                    + Make a payment
                  </button>
                  <button onClick={() => setShowCreateLiveSessionModal(true)} className="btn-secondary" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                    + Live session
                  </button>
                  <button onClick={handleAddSessionClick} className="btn-primary">
                    + Add session
                  </button>
                </div>
              </div>

              {showAddSession && (
                <div className="card mb-6">
                  <h3 className="font-display text-lg font-semibold mb-4">
                    {editingSessionId ? 'Edit session' : 'Create new session'}
                  </h3>
                  <form onSubmit={handleCreateSession} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Session description (optional)</label>
                      <input
                        type="text"
                        value={sessionDescription}
                        onChange={(e) => setSessionDescription(e.target.value)}
                        className="field"
                        placeholder="e.g., January 2024 Dues"
                      />
                    </div>

                    <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--canvas)' }}>
                      <label className="block text-sm font-medium mb-2">Quick split</label>
                      <div className="flex flex-wrap items-end gap-2">
                        <div>
                          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Total amount</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={splitTotalAmount}
                            onChange={(e) => setSplitTotalAmount(e.target.value)}
                            onKeyDown={blockNumberArrowKeys}
                            onWheel={blockNumberScroll}
                            className="field amount no-spinner w-28 px-2 py-1"
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Paid by</label>
                          <select
                            value={splitPayerId ?? ''}
                            onChange={(e) => setSplitPayerId(e.target.value ? Number(e.target.value) : null)}
                            className="field px-2 py-1"
                            disabled={sessionMembers.length === 0}
                          >
                            {sessionMembers.length === 0 && <option value="">Add members first</option>}
                            {sessionMembers.map(sm => {
                              const member = members.find(m => m.user_id === sm.user_id)
                              const displayName = member ? formatDisplayName(members, member) : sm.username
                              return (
                                <option key={sm.user_id} value={sm.user_id}>{displayName}</option>
                              )
                            })}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={handleSplitEvenly}
                          className="btn-secondary text-sm py-1"
                          disabled={sessionMembers.length < 2 || !splitTotalAmount}
                        >
                          Split evenly
                        </button>
                      </div>
                      <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                        Add everyone splitting the bill below, then split the total evenly between them. you can still fine-tune any amount after.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium">Members & amounts</label>
                        <div className="relative member-dropdown-container">
                          <button
                            type="button"
                            onClick={() => handleAddMemberToSession()}
                            className="btn-secondary text-sm py-1"
                          >
                            + Add member
                          </button>
                          {showMemberDropdown && (
                            <div
                              className="absolute right-0 mt-1 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto min-w-[200px] border member-dropdown-container"
                              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                            >
                              {activeMembers
                                .filter(m => !sessionMembers.some(sm => sm.user_id === m.user_id))
                                .map((member) => (
                                  <button
                                    key={member.user_id}
                                    type="button"
                                    onClick={() => handleAddMemberToSession(member.user_id)}
                                    className="w-full flex items-center gap-2 text-left px-4 py-2 transition-colors hover:bg-[var(--canvas)]"
                                  >
                                    <Avatar url={member.avatar_url} name={formatDisplayName(members, member)} size={28} />
                                    <div>
                                      <p className="font-medium text-sm">{formatDisplayName(members, member)}</p>
                                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{member.username}</p>
                                    </div>
                                  </button>
                                ))}
                              {activeMembers.filter(m => !sessionMembers.some(sm => sm.user_id === m.user_id)).length === 0 && (
                                <p className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>All members added</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {sessionMembers.length === 0 ? (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No members added yet</p>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {sessionMembers.map((sm) => (
                            <div
                              key={sm.user_id}
                              className="flex items-center gap-2 p-3 rounded-lg border"
                              style={{ borderColor: 'var(--border)' }}
                            >
                              <div className="flex-1 flex items-center gap-2">
                                {(() => {
                                  const member = members.find(m => m.user_id === sm.user_id)
                                  const displayName = member ? formatDisplayName(members, member) : sm.username
                                  return (
                                    <>
                                      <Avatar url={member?.avatar_url} name={displayName} size={32} />
                                      <div>
                                        <p className="font-medium text-sm">{displayName}</p>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{sm.username}</p>
                                      </div>
                                    </>
                                  )
                                })()}
                              </div>
                              <input
                                type="number"
                                step="0.01"
                                value={sm.amount}
                                onChange={(e) => {
                                  const updated = sessionMembers.map(m =>
                                    m.user_id === sm.user_id
                                      ? { ...m, amount: e.target.value }
                                      : m
                                  )
                                  setSessionMembers(updated)
                                }}
                                onKeyDown={blockNumberArrowKeys}
                                onWheel={blockNumberScroll}
                                className="field amount no-spinner w-24 px-2 py-1"
                                placeholder="0.00"
                                required
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveMemberFromSession(sm.user_id)}
                                className="px-3 py-1 rounded transition text-sm font-medium"
                                style={{ color: 'var(--negative)' }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          </div>
                          <div className="mt-4 p-3 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--canvas)' }}>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Total sum</span>
                              <span
                                className="amount text-lg font-semibold"
                                style={{
                                  color: Math.abs(sessionMembers.reduce((sum, sm) => sum + parseFloat(sm.amount || '0'), 0)) < 0.01
                                    ? 'var(--accent)'
                                    : 'var(--negative)',
                                }}
                              >
                                ${sessionMembers.reduce((sum, sm) => sum + parseFloat(sm.amount || '0'), 0).toFixed(2)}
                              </span>
                            </div>
                            {Math.abs(sessionMembers.reduce((sum, sm) => sum + parseFloat(sm.amount || '0'), 0)) >= 0.01 && (
                              <p className="text-xs mt-1" style={{ color: 'var(--negative)' }}>Sum must equal $0.00 to create session</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button type="submit" disabled={isBusy('createSession')} className="btn-primary">
                        {editingSessionId ? 'Update session' : 'Create session'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddSession(false)
                          setSessionDescription('')
                          setSessionMembers([])
                          setSplitTotalAmount('')
                          setSplitPayerId(null)
                          setEditingSessionId(null)
                          setViewingSessionId(null)
                          setShowMemberDropdown(false)
                        }}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

                <>
                  {sessions.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No sessions yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {sessions
                        .filter(session => session.id !== editingSessionId && !session.rejectedByMeAsProposal)
                        .sort((a, b) => {
                          // Check if sessions have special statuses
                          const aHasSpecialStatus = a.pendingApproval || a.pendingRejection || a.waitingForApproval
                          const bHasSpecialStatus = b.pendingApproval || b.pendingRejection || b.waitingForApproval
                          
                          // If one has special status and the other doesn't, special status comes first
                          if (aHasSpecialStatus && !bHasSpecialStatus) return -1
                          if (!aHasSpecialStatus && bHasSpecialStatus) return 1
                          
                          // If both have special status or both are normal, sort by created_at (newest first)
                          const aDate = new Date(a.created_at).getTime()
                          const bDate = new Date(b.created_at).getTime()
                          return bDate - aDate
                        })
                        .map((session) => {
                          const pendingApproval = pendingApprovals.find(pa => pa.session_id === session.id)
                          const pendingRejection = pendingRejections.find(pr => pr.session_id === session.id)
                          
                          // Show rejection UI if session has pendingRejection and there's a pending rejection record
                          const hasUndismissedRejection = session.pendingRejection && pendingRejection
                          
                          return (
                          <div
                            key={session.id}
                            onClick={() => {
                              // Each row is an accordion: click to expand, click again to collapse.
                              if (session.pendingApproval && pendingApproval) {
                                setViewingSessionId(viewingSessionId === session.id ? null : session.id)
                              } else if (hasUndismissedRejection) {
                                setViewingSessionId(viewingSessionId === session.id ? null : session.id)
                              } else if (session.is_live) {
                                if (selectedLiveSession === session.id) {
                                  setSelectedLiveSession(null)
                                  setLiveSessionAmount('')
                                  setSessionDetails([])
                                } else {
                                  handleOpenLiveSession(session.id)
                                }
                              } else if (viewingSessionId === session.id) {
                                setViewingSessionId(null)
                              } else {
                                handleViewSession(session.id)
                              }
                            }}
                            id={`session-row-${session.id}`}
                            className="card cursor-pointer transition-colors hover:border-[var(--accent)]"
                            style={
                              session.is_live
                                ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' }
                                : undefined
                            }
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold">
                                    {session.Description || 'Untitled Session'}
                                  </p>
                                  {session.is_payment && (
                                    <ArrowRightLeft size={14} style={{ color: 'var(--text-muted)' }} aria-label="Payment session" />
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                    {new Date(session.created_at).toLocaleDateString()}
                                  </p>
                                  {session.userPayment !== null && session.userPayment !== undefined && (
                                    <p
                                      className="amount text-sm font-semibold"
                                      style={{ color: session.userPayment >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                                    >
                                      {session.userPayment >= 0 ? '+' : '-'}${Math.abs(session.userPayment).toFixed(2)}
                                    </p>
                                  )}
                                  {session.is_payment && session.payment_method && (
                                    <span
                                      className="inline-flex"
                                      title={paymentMethodLabel(session.payment_method) || undefined}
                                    >
                                      <PaymentMethodIcon method={session.payment_method} size={16} />
                                    </span>
                                  )}
                                  {session.is_live && <span className="badge badge-accent-solid">Live</span>}
                                  {!session.is_live && (session.Description?.includes('Live Session') || session.Description === 'Live Session') && (
                                    <span className="badge badge-outline flex items-center gap-1">
                                      <ClipboardList size={12} />
                                      Previously live
                                    </span>
                                  )}
                                  {session.pendingApproval && (
                                    <span className="badge badge-accent flex items-center gap-1">
                                      {session.pendingIsDeletion ? <Trash2 size={12} /> : <TriangleAlert size={12} />}
                                      {session.pendingIsDeletion ? 'Deletion requested' : 'Pending approval'}
                                    </span>
                                  )}
                                  {hasUndismissedRejection && (
                                    <span className="badge badge-negative flex items-center gap-1">
                                      <XCircle size={12} />
                                      <span>{pendingRejection?.is_deletion ? 'Deletion rejected' : 'Edit rejected'}</span>
                                    </span>
                                  )}
                                  {session.waitingForApproval && (
                                    <span className="badge badge-accent flex items-center gap-1">
                                      {session.pendingIsDeletion ? <Trash2 size={12} /> : <Hourglass size={12} />}
                                      {session.pendingIsDeletion ? 'Deletion pending' : 'Waiting for approval'}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {session.is_live && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setConfirmCancelSessionId(session.id)
                                      }}
                                      className="btn-secondary text-sm py-1"
                                      style={{ borderColor: 'var(--negative)', color: 'var(--negative)' }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleCloseLiveSession(session.id)
                                      }}
                                      disabled={isBusy(`closeLiveSession:${session.id}`)}
                                      className="btn-danger text-sm py-1"
                                    >
                                      Close session
                                    </button>
                                  </>
                                )}
                                {!session.is_live && session.waitingForApproval && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setConfirmCancelEditSessionId(session.id)
                                    }}
                                    className="btn-secondary text-sm py-1"
                                    style={{ borderColor: 'var(--negative)', color: 'var(--negative)' }}
                                  >
                                    {cancelActionLabel(pendingSessionKind(session))}
                                  </button>
                                )}
                                {!session.is_live && !session.pendingApproval && !hasUndismissedRejection && !session.waitingForApproval && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditSession(session.id)
                                      }}
                                      disabled={isBusy(`editSession:${session.id}`)}
                                      className="btn-secondary text-sm py-1"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setConfirmDeleteSessionId(session.id)
                                      }}
                                      className="p-1.5 rounded-md transition-colors text-[var(--text-muted)] hover:text-[var(--negative)] hover:bg-[var(--negative-soft)]"
                                      title="Delete session"
                                      aria-label="Delete session"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            {viewingSessionId === session.id && (
                              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
                                {renderSessionExpansion(session, pendingApproval, pendingRejection, hasUndismissedRejection)}
                              </div>
                            )}
                            {selectedLiveSession === session.id && (
                              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
                                <p className="eyebrow mb-3">Live session payments</p>

                                {/* Show all payments */}
                                {sessionDetails.length > 0 && (
                                  <div className="mb-4">
                                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Current payments</p>
                                    <div className="space-y-2">
                                      {sessionDetails.map((detail) => (
                                        <div
                                          key={detail.user_id}
                                          className="rounded-lg p-3 flex items-center justify-between border"
                                          style={{ borderColor: 'var(--border)', background: 'var(--canvas)' }}
                                        >
                                          <div className="flex items-center gap-3">
                                            {(() => {
                                              const member = members.find(m => m.user_id === detail.user_id)
                                              const displayName = member ? formatDisplayName(members, member) : detail.username
                                              return (
                                                <>
                                                  <Avatar url={member?.avatar_url} name={displayName} size={32} />
                                                  <div>
                                                    <p className="font-medium text-sm">
                                                      {displayName}
                                                      {detail.user_id === userId && (
                                                        <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>(You)</span>
                                                      )}
                                                    </p>
                                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{detail.username}</p>
                                                  </div>
                                                </>
                                              )
                                            })()}
                                          </div>
                                          <p
                                            className="amount text-sm font-semibold"
                                            style={{ color: detail.amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                                          >
                                            {detail.amount >= 0 ? '+' : ''}${detail.amount.toFixed(2)}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* User's payment input */}
                                <div>
                                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Your payment</p>
                                  <div className="flex gap-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={liveSessionAmount}
                                      onChange={(e) => setLiveSessionAmount(e.target.value)}
                                      onWheel={blockNumberScroll}
                                      className="field amount flex-1"
                                      placeholder="0.00"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleAddToLiveSession(session.id)}
                                      className="btn-primary"
                                      disabled={liveSessionAmount === '' || isBusy(`addToLiveSession:${session.id}`)}
                                    >
                                      {liveSessionAmount && session.userPayment !== null && session.userPayment !== undefined && parseFloat(liveSessionAmount) !== session.userPayment ? 'Update' : 'Save'}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSelectedLiveSession(null)
                                        setLiveSessionAmount('')
                                        setSessionDetails([])
                                      }}
                                      className="btn-secondary"
                                    >
                                      Dismiss
                                    </button>
                                  </div>
                                </div>

                                {/* Show current total */}
                                {sessionDetails.length > 0 && (
                                  <div className="mt-3 p-2 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--canvas)' }}>
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium">Current total</span>
                                      <span
                                        className="amount text-sm font-semibold"
                                        style={{
                                          color: Math.abs(sessionDetails.reduce((sum, d) => sum + d.amount, 0)) < 0.01
                                            ? 'var(--accent)'
                                            : 'var(--negative)',
                                        }}
                                      >
                                        ${sessionDetails.reduce((sum, d) => sum + d.amount, 0).toFixed(2)}
                                      </span>
                                    </div>
                                    {Math.abs(sessionDetails.reduce((sum, d) => sum + d.amount, 0)) >= 0.01 && (
                                      <p className="text-xs mt-1" style={{ color: 'var(--negative)' }}>Sum must equal $0.00 to close session</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          )
                        })}
                    </div>
                  )}
                </>

              {confirmCancelSessionId !== null && (
                <div className="modal-overlay">
                  <div className="modal-panel">
                    <h3 className="font-display text-xl font-semibold mb-2">Cancel this live session?</h3>
                    <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                      Every amount entered so far will be discarded. This can&apos;t be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCancelLiveSession(confirmCancelSessionId)}
                        disabled={isBusy(`cancelLiveSession:${confirmCancelSessionId}`)}
                        className="btn-danger flex-1"
                      >
                        Cancel session
                      </button>
                      <button onClick={() => setConfirmCancelSessionId(null)} className="btn-secondary">
                        Keep session
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {confirmDeleteSessionId !== null && (
                <div className="modal-overlay">
                  <div className="modal-panel">
                    <h3 className="font-display text-xl font-semibold mb-2">Delete this session?</h3>
                    <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                      The other members of this session will need to approve before it&apos;s removed. This can&apos;t be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeleteSession(confirmDeleteSessionId)}
                        disabled={isBusy(`deleteSession:${confirmDeleteSessionId}`)}
                        className="btn-danger flex-1"
                      >
                        Request deletion
                      </button>
                      <button onClick={() => setConfirmDeleteSessionId(null)} className="btn-secondary">
                        Keep session
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {confirmCancelEditSessionId !== null && (() => {
                const targetSession = sessions.find(s => s.id === confirmCancelEditSessionId)
                const kind = pendingSessionKind(targetSession || {})
                const copy = cancelActionCopy(kind)
                return (
                  <div className="modal-overlay">
                    <div className="modal-panel">
                      <h3 className="font-display text-xl font-semibold mb-2">{copy.title}</h3>
                      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>{copy.body}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleCancelEdit(confirmCancelEditSessionId)}
                          disabled={isBusy(`cancelEdit:${confirmCancelEditSessionId}`)}
                          className="btn-danger flex-1"
                        >
                          {cancelActionLabel(kind)}
                        </button>
                        <button onClick={() => setConfirmCancelEditSessionId(null)} className="btn-secondary">
                          Keep waiting
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {rejectingApproval !== null && (
                <div className="modal-overlay">
                  <div className="modal-panel">
                    <h3 className="font-display text-xl font-semibold mb-2">
                      {rejectingApproval.isDeletion ? 'Keep this session?' : 'Reject this edit?'}
                    </h3>
                    <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                      Let the editor know why. they&apos;ll see this on the rejection notice.
                    </p>
                    <textarea
                      value={rejectReasonDraft}
                      onChange={(e) => setRejectReasonDraft(e.target.value)}
                      className="field mb-4"
                      rows={3}
                      placeholder={rejectingApproval.isDeletion ? 'e.g. We still need this for something' : 'e.g. I never received this payment'}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const reason = rejectReasonDraft.trim()
                          if (!reason || !rejectingApproval) return
                          handleRejectEdit(rejectingApproval.approvalId, rejectingApproval.sessionId, rejectingApproval.editorUserId, reason)
                          setRejectingApproval(null)
                        }}
                        disabled={!rejectReasonDraft.trim() || isBusy(`rejectEdit:${rejectingApproval.approvalId}`)}
                        className="btn-danger flex-1"
                      >
                        {rejectingApproval.isDeletion ? 'Keep session' : 'Reject'}
                      </button>
                      <button
                        onClick={() => setRejectingApproval(null)}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {showCreateLiveSessionModal && (
                <div className="modal-overlay">
                  <div className="modal-panel">
                    <h3 className="font-display text-xl font-semibold mb-4">Start a live session</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        handleCreateLiveSession(liveSessionDescription.trim())
                      }}
                      className="space-y-4"
                    >
                      <div>
                        <label htmlFor="liveSessionDescription" className="block text-sm font-medium mb-1">
                          Description (optional)
                        </label>
                        <input
                          id="liveSessionDescription"
                          type="text"
                          value={liveSessionDescription}
                          onChange={(e) => setLiveSessionDescription(e.target.value)}
                          className="field"
                          placeholder="e.g., Bar tab"
                          autoFocus
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="submit" disabled={isBusy('createLiveSession')} className="btn-primary flex-1">
                          Start session
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateLiveSessionModal(false)
                            setLiveSessionDescription('')
                          }}
                          className="btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {showMakePaymentModal && (
            <div className="modal-overlay">
              <div className="modal-panel">
                <h3 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
                  Make a payment
                  <InfoTooltip label="How this affects balances">
                    This records money you already sent outside the app (Venmo, cash, etc.).
                    Dues doesn&apos;t move money itself. It won&apos;t affect either balance until the
                    other person confirms they received it. that way no one can clear their own
                    debt by just claiming a payment that didn&apos;t happen. Once confirmed, your
                    balance goes up (you owe less, or you&apos;re owed more) and theirs goes down by
                    the same amount.
                  </InfoTooltip>
                </h3>

                <form onSubmit={handleMakePayment} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Pay to
                    </label>
                    <select
                      value={paymentPayee || ''}
                      onChange={(e) => setPaymentPayee(e.target.value ? parseInt(e.target.value) : null)}
                      className="field"
                      required
                      autoFocus
                    >
                      <option value="">Select a member</option>
                      {activeMembers
                        .filter(m => m.user_id !== userId)
                        .map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {formatDisplayName(members, member)} (@{member.username})
                          </option>
                        ))}
                    </select>
                    {activeMembers.filter(m => m.user_id !== userId).length === 0 && (
                      <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>No other members in this group</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Amount ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      onWheel={blockNumberScroll}
                      className="field amount"
                      placeholder="0.00"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Paid via (optional)
                    </label>
                    <div className="method-select-row" role="radiogroup" aria-label="Payment method">
                      {PAYMENT_METHOD_OPTIONS.map((option) => {
                        const isSelected = paymentMethod === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            title={option.label}
                            onClick={() => setPaymentMethod(isSelected ? '' : option.value)}
                            className={`method-select-btn${isSelected ? ' selected' : ''}`}
                          >
                            <PaymentMethodBadge method={option.value} size={26} />
                            <span>{option.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Description (optional)
                    </label>
                    <input
                      type="text"
                      value={paymentDescription}
                      onChange={(e) => setPaymentDescription(e.target.value)}
                      className="field"
                      placeholder="e.g., Payment for dinner"
                    />
                  </div>

                  {paymentPayee && (() => {
                    const payee = members.find((m) => m.user_id === paymentPayee)
                    if (!payee) return null
                    const payeeName = formatDisplayName(members, payee)
                    return (
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setProfileModalContext({
                              amount: parseFloat(paymentAmount) || undefined,
                              note: paymentDescription.trim() || group?.name || undefined,
                            })
                            setProfileModalUserId(paymentPayee)
                          }}
                          className="pay-pill inline-flex items-center gap-2"
                        >
                          <Avatar url={payee.avatar_url} name={payeeName} size={18} />
                          See how to pay {payeeName} ↗
                        </button>
                      </div>
                    )
                  })()}

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="btn-primary flex-1"
                      disabled={!paymentPayee || !paymentAmount || isSubmittingPayment || activeMembers.filter(m => m.user_id !== userId).length === 0}
                    >
                      {isSubmittingPayment ? 'Recording…' : 'Record payment'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMakePaymentModal(false)
                        setPaymentPayee(null)
                        setPaymentAmount('')
                        setPaymentDescription('')
                        setPaymentMethod('')
                      }}
                      disabled={isSubmittingPayment}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {profileModalUserId !== null && userId && (
            <ProfileModal
              userId={profileModalUserId}
              currentUserId={userId}
              amount={profileModalContext.amount}
              note={profileModalContext.note}
              onClose={() => setProfileModalUserId(null)}
            />
          )}

          {activeTab === 'info' && (
            <div>
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                <h2 className="font-display text-2xl font-semibold">{group.name || 'Group Info'}</h2>
                {isOwner && <span className="badge badge-accent">Owner</span>}
              </div>

              {/* Group Details — description isn't shown here anymore (see
                  the group card on the home page instead); this stays
                  numbers-only. */}
              <div className="card mb-6">
                <p className="eyebrow mb-3">Group details</p>
                <div>
                  <div className="ledger-row">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Created</span>
                    <span className="text-sm font-medium">{new Date(group.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="ledger-row">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Members</span>
                    <span className="text-sm font-medium">{members.length}</span>
                  </div>
                  <div className="ledger-row">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Sessions</span>
                    <span className="text-sm font-medium">{sessions.length}</span>
                  </div>
                </div>
              </div>

              {/* Group Pin — the ticket stub signature. Hidden entirely for
                  everyone once the owner disables it, rather than just greyed
                  out — it no longer does anything, so showing it invites
                  confused "why doesn't this work" support requests. */}
              {group.pin && group.pin_enabled !== false && (
                <div className="mb-6">
                  <p className="eyebrow mb-3">Group pin</p>
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                    Share this pin with others so they can join your group.
                  </p>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="ticket-stub px-8 py-5">
                      <p className="amount text-center text-3xl font-semibold tracking-[0.35em]" style={{ color: 'var(--accent)' }}>
                        {showPin ? group.pin : '••••••'}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => setShowPin(!showPin)} className="btn-secondary text-sm">
                        {showPin ? 'Hide' : 'Show'}
                      </button>
                      <button onClick={handleCopyPin} className="btn-primary text-sm">
                        Copy
                      </button>
                      {isOwner && (
                        <>
                          <button onClick={handleRegeneratePin} className="btn-secondary text-sm" disabled={pinActionLoading}>
                            Regenerate
                          </button>
                          <button onClick={() => handleTogglePinEnabled(false)} className="btn-secondary text-sm" disabled={pinActionLoading}>
                            Disable pin
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isOwner && group.pin_enabled === false && (
                <div className="card mb-6">
                  <p className="eyebrow mb-3">Group pin</p>
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                    The join pin is disabled — no one can use it to join this group right now.
                  </p>
                  <button onClick={() => handleTogglePinEnabled(true)} className="btn-primary text-sm" disabled={pinActionLoading}>
                    Enable pin
                  </button>
                </div>
              )}

              {isOwner && (
                <>
                  {/* Banner — just a small thumbnail here, not the full-size
                      hero (that's already visible for real at the top of
                      the page). One settings row: icon on the left, status
                      + actions on the right, all vertically centered — this
                      card used to also hold the color swatch picker, but
                      with that gone (photo-only now) a single row reads
                      better than the icon-then-caption stack it was before. */}
                  <div className="card mb-6">
                    <p className="eyebrow mb-3">Group banner</p>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => bannerInputRef.current?.click()}
                        disabled={uploadingBanner}
                        className="relative rounded-md overflow-hidden shrink-0 disabled:opacity-50"
                        style={{ width: 56, height: 56, background: 'var(--accent-soft)', border: '1px solid var(--border)' }}
                        title={group.banner_url ? 'Change photo' : 'Upload a photo'}
                      >
                        {group.banner_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- data: URL thumbnail, not worth next/image's optimizer here
                          <img src={group.banner_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Camera size={18} className="mx-auto" style={{ color: 'var(--text-muted)' }} />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {group.banner_url ? 'Shown at the top of the group page' : 'No banner set yet'}
                        </p>
                        <div className="flex items-center gap-3 text-xs mt-1">
                          {uploadingBanner ? (
                            <span style={{ color: 'var(--text-muted)' }}>Saving banner…</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => bannerInputRef.current?.click()}
                                className="hover:underline font-medium"
                                style={{ color: 'var(--accent)' }}
                              >
                                {group.banner_url ? 'Change photo' : 'Upload photo'}
                              </button>
                              {group.banner_url && (
                                <button type="button" onClick={() => setConfirmRemoveBanner(true)} className="hover:underline" style={{ color: 'var(--text-muted)' }}>
                                  Remove
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <input
                      ref={bannerInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleBannerFileSelected}
                      className="hidden"
                    />
                    {bannerError && !pendingBannerValue && (
                      <p className="text-xs mt-2" style={{ color: 'var(--negative)' }}>{bannerError}</p>
                    )}
                  </div>

                  {pendingBannerFile && (
                    <BannerCropModal
                      file={pendingBannerFile}
                      onCancel={() => setPendingBannerFile(null)}
                      onConfirm={handleBannerCropConfirm}
                    />
                  )}

                  {pendingBannerValue && (
                    <div className="modal-overlay">
                      <div className="modal-panel">
                        <h3 className="font-display text-xl font-semibold mb-2">Update group banner?</h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                          Here&apos;s how it&apos;ll look at the top of the group page.
                        </p>
                        <div className="rounded-lg overflow-hidden mb-4" style={{ height: 100, border: '1px solid var(--border)' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL preview, not worth next/image's optimizer here */}
                          <img src={pendingBannerValue} alt="" className="w-full h-full object-cover" />
                        </div>
                        {bannerError && (
                          <p className="text-xs mb-3" style={{ color: 'var(--negative)' }}>{bannerError}</p>
                        )}
                        <div className="flex gap-2">
                          <button onClick={handleApproveBanner} className="btn-primary flex-1" disabled={uploadingBanner}>
                            {uploadingBanner ? 'Saving…' : 'Save banner'}
                          </button>
                          <button onClick={handleCancelPendingBanner} className="btn-secondary" disabled={uploadingBanner}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {confirmRemoveBanner && (
                    <div className="modal-overlay">
                      <div className="modal-panel">
                        <h3 className="font-display text-xl font-semibold mb-2">Remove group banner?</h3>
                        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                          You&apos;ll go back to no banner until you upload a new one.
                        </p>
                        <div className="flex gap-2">
                          <button onClick={handleRemoveBanner} className="btn-danger flex-1" disabled={uploadingBanner}>
                            {uploadingBanner ? 'Removing…' : 'Remove banner'}
                          </button>
                          <button onClick={() => setConfirmRemoveBanner(false)} className="btn-secondary" disabled={uploadingBanner}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Rename / description */}
                  <div className="card mb-6">
                    <p className="eyebrow mb-3">Edit group details</p>
                    <form onSubmit={handleSaveGroupDetails} className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">Group name</label>
                        <input
                          type="text"
                          value={groupNameDraft}
                          onChange={(e) => setGroupNameDraft(e.target.value)}
                          className="field"
                          placeholder="e.g., Apartment 4B"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Description (optional)</label>
                        <textarea
                          value={groupDescriptionDraft}
                          onChange={(e) => setGroupDescriptionDraft(e.target.value)}
                          className="field"
                          rows={2}
                          placeholder="What this group is for"
                        />
                      </div>
                      <button
                        type="submit"
                        className="btn-primary text-sm"
                        disabled={savingGroupDetails || (groupNameDraft.trim() === (group.name || '').trim() && groupDescriptionDraft.trim() === (group.description || '').trim())}
                      >
                        {savingGroupDetails ? 'Saving…' : 'Save changes'}
                      </button>
                    </form>
                  </div>

                  {/* Transfer ownership */}
                  <div className="card mb-6">
                    <p className="eyebrow mb-3">Transfer ownership</p>
                    {activeMembers.filter(m => m.user_id !== userId).length === 0 ? (
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        There&apos;s no one else in this group to transfer ownership to yet.
                      </p>
                    ) : (
                      <>
                        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
                          Makes someone else the owner. You&apos;ll become a regular member.
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={transferTargetUserId ?? ''}
                            onChange={(e) => setTransferTargetUserId(e.target.value ? Number(e.target.value) : null)}
                            className="field px-2 py-1"
                          >
                            <option value="">Choose a member…</option>
                            {activeMembers.filter(m => m.user_id !== userId).map((member) => (
                              <option key={member.user_id} value={member.user_id}>
                                {formatDisplayName(members, member)}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => setShowTransferConfirm(true)}
                            className="btn-secondary text-sm"
                            disabled={!transferTargetUserId}
                          >
                            Transfer ownership
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Danger zone */}
                  <div className="card mb-6" style={{ borderColor: 'var(--negative)' }}>
                    <p className="eyebrow mb-3" style={{ color: 'var(--negative)' }}>Danger zone</p>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <p className="text-sm font-medium">Delete this group</p>
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Everyone loses access immediately. You can restore it later from your account Settings.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowDeleteGroupConfirm(true)}
                        className="btn-danger text-sm shrink-0"
                      >
                        Delete group
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Leave group — owners can't leave (someone has to hold the
                  pin/settings) unless they transfer ownership first, and
                  leave_group enforces the same $0-balance rule as removing a
                  member, so this stays disabled until settled up too. */}
              <div className="card mt-6">
                <p className="eyebrow mb-3">Leave group</p>
                {isOwner ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    As the owner, you can&apos;t leave this group. Transfer ownership to another member first, or delete the group instead.
                  </p>
                ) : (
                  <>
                    <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                      You&apos;ll lose access to this group. Your balance must be $0.00 first. settle up before leaving.
                    </p>
                    <button
                      onClick={() => setConfirmLeaveGroup(true)}
                      className="btn-danger"
                      disabled={Math.abs(netBalance) >= 1}
                      title={Math.abs(netBalance) >= 1 ? 'Your balance must be $0.00 before you can leave' : undefined}
                    >
                      Leave group
                    </button>
                  </>
                )}
              </div>

              {confirmLeaveGroup && (
                <div className="modal-overlay">
                  <div className="modal-panel">
                    <h3 className="font-display text-xl font-semibold mb-2">Leave {group.name || 'this group'}?</h3>
                    <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                      You&apos;ll lose access right away, but your past sessions and payments stay untouched. You can request to rejoin later.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={handleLeaveGroup} className="btn-danger flex-1" disabled={leavingGroup}>
                        {leavingGroup ? 'Leaving…' : 'Leave group'}
                      </button>
                      <button onClick={() => setConfirmLeaveGroup(false)} className="btn-secondary" disabled={leavingGroup}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {showTransferConfirm && transferTargetUserId && (() => {
                const target = activeMembers.find(m => m.user_id === transferTargetUserId)
                return (
                  <div className="modal-overlay">
                    <div className="modal-panel">
                      <h3 className="font-display text-xl font-semibold mb-2">
                        Transfer ownership to {target ? formatDisplayName(members, target) : 'this member'}?
                      </h3>
                      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                        They&apos;ll become the owner of {group.name || 'this group'} and you&apos;ll become a regular member. This can be undone by them transferring it back.
                      </p>
                      <div className="flex gap-2">
                        <button onClick={handleTransferOwnership} className="btn-primary flex-1" disabled={transferringOwnership}>
                          {transferringOwnership ? 'Transferring…' : 'Transfer ownership'}
                        </button>
                        <button onClick={() => setShowTransferConfirm(false)} className="btn-secondary" disabled={transferringOwnership}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {showDeleteGroupConfirm && (
                <div className="modal-overlay">
                  <div className="modal-panel">
                    <h3 className="font-display text-xl font-semibold mb-2">Delete {group.name || 'this group'}?</h3>
                    <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                      Every member loses access right away, and it disappears from everyone&apos;s group list. You (as the owner) can restore it later from your account Settings.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteGroupConfirmClick}
                        className="btn-danger flex-1"
                        disabled={deletingGroup}
                      >
                        {deletingGroup ? 'Deleting…' : 'Delete group'}
                      </button>
                      <button
                        onClick={() => setShowDeleteGroupConfirm(false)}
                        className="btn-secondary"
                        disabled={deletingGroup}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Extra step when the group isn't fully settled up — deleting
                  doesn't require a $0 balance (unlike leaving/removal), but
                  whatever anyone's still owed just disappears with the group,
                  so that's worth a second, more explicit confirmation. */}
              {showDeleteBalanceWarning && (
                <div className="modal-overlay">
                  <div className="modal-panel">
                    <h3 className="font-display text-xl font-semibold mb-2 flex items-center gap-2">
                      <TriangleAlert size={20} style={{ color: 'var(--negative)' }} />
                      Members still have a balance
                    </h3>
                    <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                      Not everyone in {group.name || 'this group'} is settled up yet:
                    </p>
                    <div className="space-y-1 mb-4">
                      {memberBalances.filter(m => Math.abs(m.balance) >= 1).map(m => (
                        <div key={m.user_id} className="ledger-row">
                          <span className="text-sm">{formatDisplayName(members, m)}</span>
                          <span className="amount text-sm font-semibold" style={{ color: m.balance >= 0 ? 'var(--accent)' : 'var(--negative)' }}>
                            {m.balance >= 0 ? '+' : ''}${(m.balance / 100).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                      Deleting won&apos;t settle these — they just disappear along with the group.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteGroup}
                        className="btn-danger flex-1"
                        disabled={deletingGroup}
                      >
                        {deletingGroup ? 'Deleting…' : 'Delete anyway'}
                      </button>
                      <button
                        onClick={() => setShowDeleteBalanceWarning(false)}
                        className="btn-secondary"
                        disabled={deletingGroup}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </main>
  )
}

