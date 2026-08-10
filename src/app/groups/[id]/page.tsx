'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
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
import Avatar from '@/components/Avatar'
import InfoTooltip from '@/components/InfoTooltip'
import useAuth from '@/hooks/useAuth'
import useToast from '@/hooks/useToast'
import { supabase } from '@/lib/supabase'
import { getOrCreateUser } from '@/lib/userHelper'

interface Group {
  id: number
  name: string | null
  created_at: string
  created_by: number | null
  pin?: string | null
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
  memberCount?: number
  totalAmount?: number
  userPayment?: number | null
  pendingApproval?: boolean
  pendingRejection?: boolean
  waitingForApproval?: boolean // Editor is waiting for others to approve
  pendingIsDeletion?: boolean // The in-flight approval (either direction above) is a deletion request, not an amount edit
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

export default function GroupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const groupId = parseInt(params.id as string)
  const { user, loading: authLoading } = useAuth()
  const [group, setGroup] = useState<Group | null>(null)
  const [dues, setDues] = useState<Due[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<number | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [pendingJoinRequests, setPendingJoinRequests] = useState<Array<{ id: number; user_id: number; displayName: string; username: string; created_at: string }>>([])
  const [showPin, setShowPin] = useState(false)
  const [activeTab, setActiveTab] = useState<'dues' | 'members' | 'sessions' | 'info'>('dues')
  const [showMakePaymentModal, setShowMakePaymentModal] = useState(false)
  const [paymentPayee, setPaymentPayee] = useState<number | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDescription, setPaymentDescription] = useState('')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showAddSession, setShowAddSession] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null)
  const [viewingSessionId, setViewingSessionId] = useState<number | null>(null)
  const [sessionDescription, setSessionDescription] = useState('')
  const [sessionMembers, setSessionMembers] = useState<Array<{ user_id: number; email: string; username: string; first_name?: string; last_name?: string; amount: string }>>([])
  const [showMemberDropdown, setShowMemberDropdown] = useState(false)
  const [sessionDetails, setSessionDetails] = useState<Array<{ user_id: number; email: string; username: string; first_name?: string; last_name?: string; amount: number }>>([])
  const [selectedLiveSession, setSelectedLiveSession] = useState<number | null>(null)
  const [liveSessionAmount, setLiveSessionAmount] = useState('')
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: number; session_id: number; editor_user_id: number; old_amount: number; new_amount: number; session_description: string; is_deletion?: boolean }>>([])
  const [pendingRejections, setPendingRejections] = useState<Array<{ id: number; session_id: number; approver_user_id: number; session_description: string; approver_name?: string; approver_email?: string; rejected_at?: string; is_deletion?: boolean }>>([])
  const [pendingCancellations, setPendingCancellations] = useState<Array<{ id: number; session_id: number; session_description: string; old_amount: number; new_amount: number; is_deletion?: boolean }>>([])
  const [pendingRejectionNotices, setPendingRejectionNotices] = useState<Array<{ id: number; session_id: number; session_description: string; rejected_by_name?: string; is_deletion?: boolean }>>([])
  const [originalPayments, setOriginalPayments] = useState<Array<{ user_id: number; amount: number }>>([])
  const [allSessionApprovals, setAllSessionApprovals] = useState<Array<{ user_id: number; old_amount: number; new_amount: number }>>([])
  const [editorUserId, setEditorUserId] = useState<number | null>(null)
  const [confirmCancelSessionId, setConfirmCancelSessionId] = useState<number | null>(null)
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<number | null>(null)
  const [confirmCancelEditSessionId, setConfirmCancelEditSessionId] = useState<number | null>(null)
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<number | null>(null)
  const [editingNotesSessionId, setEditingNotesSessionId] = useState<number | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [showCreateLiveSessionModal, setShowCreateLiveSessionModal] = useState(false)
  const [liveSessionDescription, setLiveSessionDescription] = useState('')
  const [profileModalUserId, setProfileModalUserId] = useState<number | null>(null)
  const [profileModalContext, setProfileModalContext] = useState<{ amount?: number; note?: string }>({})
  const { toasts, showToast, dismiss } = useToast()

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
        setGroup({
          id: data.id,
          name: data.name,
          created_at: data.created_at,
          created_by: data.created_by,
          pin: data.pin
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
      const userMap: Record<number, { username: string; first_name: string; last_name: string }> = {}

      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from('User')
          .select('id, username, first_name, last_name')
          .in('id', userIds)

        if (usersData) {
          usersData.forEach((u: any) => {
            userMap[u.id] = {
              username: u.username || 'Unknown',
              first_name: u.first_name || '',
              last_name: u.last_name || '',
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
      let formattedRejections: Array<{ id: number; session_id: number; approver_user_id: number; session_description: string; approver_name?: string; approver_email?: string; rejected_at?: string }> = []
      
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
            is_deletion: !!r.is_deletion
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

  const handleViewSession = async (sessionId: number) => {
    setViewingSessionId(sessionId)
    await loadSessionDetails(sessionId)
  }

  const handleEditSession = async (sessionId: number) => {
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
        setShowMemberDropdown(false)
      }
    } else {
      // Toggle dropdown
      setShowMemberDropdown(!showMemberDropdown)
    }
  }

  const handleRemoveMemberFromSession = (user_id: number) => {
    setSessionMembers(sessionMembers.filter(sm => sm.user_id !== user_id))
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

  const handleApproveEdit = async (approvalId: number, sessionId: number) => {
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
            showToast('Everyone approved — session deleted.')
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
        showToast('Approved — waiting on others.')
      }

      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
    } catch (error: any) {
      console.error('Error approving edit:', error)
      showToast('Failed to approve edit: ' + (error.message || 'Unknown error'))
    }
  }

  const handleRejectEdit = async (approvalId: number, sessionId: number, editorUserId: number) => {
    try {
      // Update approval status to rejected
      const { data: rejectedRow, error: updateError } = await supabase
        .from('SessionEditApproval')
        .update({ status: 'rejected' })
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
            is_deletion: isDeletion
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
                new_amount: 0
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
          ? 'Deletion rejected — the session was kept as-is. Everyone who was reviewing it has been notified.'
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

  // Editor cancels their own pending edit. The session keeps its pre-edit amounts.
  // Approvers who hadn't acted yet are simply cleared (nothing to notify). Approvers
  // who had already approved or rejected are marked 'cancelled' instead of deleted, so
  // they can be notified their review was voided (surfaced in the Dues tab's Pending
  // Actions area — see loadPendingApprovals / pendingCancellations).
  const handleCancelEdit = async (sessionId: number) => {
    if (!userId) return

    try {
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

      setConfirmCancelEditSessionId(null)
      if (viewingSessionId === sessionId) setViewingSessionId(null)
      await loadSessions()
      await loadPendingApprovals()
    } catch (error: any) {
      console.error('Error cancelling edit:', error)
      showToast('Failed to cancel edit: ' + (error.message || 'Unknown error'))
    }
  }

  // Approver acknowledges that their review of an edit was voided by the editor cancelling it.
  const handleDismissCancellation = async (id: number) => {
    try {
      const { error } = await supabase
        .from('SessionEditApproval')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
      setPendingCancellations(prev => prev.filter(c => c.id !== id))
    } catch (error: any) {
      console.error('Error dismissing cancellation notice:', error)
      showToast('Failed to dismiss notice: ' + (error.message || 'Unknown error'))
    }
  }

  // Co-approver acknowledges that an edit they were reviewing was rejected by someone else.
  const handleDismissRejectionNotice = async (id: number) => {
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

  // Helper function to update session payments
  // Thin wrapper: the session-edit form always knows the complete membership, so
  // reconcile against it directly.
  const updateSessionPayments = async (sessionId: number) => {
    await reconcileSession(sessionId, sessionMembers.map(sm => ({ user_id: sm.user_id, amount: parseFloat(sm.amount) })))
  }

  const handleCreateSession = async (e: React.FormEvent) => {
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
                showToast(`Edit saved — waiting on ${usersToNotify.length} approval${usersToNotify.length === 1 ? '' : 's'}.`)
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
  }

  const handleCreateLiveSession = async (description: string) => {
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
  }

  const handleAddToLiveSession = async (sessionId: number) => {
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

  const handleOpenLiveSession = async (sessionId: number) => {
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

  const handleCloseLiveSession = async (sessionId: number) => {
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

  // Cancel (abandon) a live session — discards every payment entered so far and
  // removes the session entirely. Distinct from "Close," which finalizes it.
  const handleCancelLiveSession = async (sessionId: number) => {
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

  // Permanently delete a closed session and everything tied to it.
  // Requests to delete a closed session. Needs unanimous approval from
  // everyone with a payment in it — same mechanism as editing amounts
  // (see handleCreateSession's approval-record creation), just proposing
  // every amount go to $0 with is_deletion marking what that really means.
  // Skips straight to performSessionDeletion only when the requester is the
  // sole participant, since there's no one else to ask.
  const handleDeleteSession = async (sessionId: number) => {
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
      showToast(`Deletion requested — ${others.length} member${others.length === 1 ? '' : 's'} must approve before the session is removed.`)
    } catch (error: any) {
      console.error('Error requesting session deletion:', error)
      showToast('Failed to request deletion: ' + (error.message || 'Unknown error'))
    }
  }

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
      setShowMakePaymentModal(false)
      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
      showToast(`Payment recorded — waiting on ${payeeName} to confirm they received it.`)
    } catch (error: any) {
      console.error('Error making payment:', error)
      showToast('Failed to record payment: ' + (error.message || 'Unknown error'))
    } finally {
      setIsSubmittingPayment(false)
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
  const handleApproveJoinRequest = async (requestId: number) => {
    try {
      const { error } = await supabase.rpc('approve_join_request', { request_id: requestId })
      if (error) throw error

      setPendingJoinRequests(prev => prev.filter(r => r.id !== requestId))
      await loadMembers()
      showToast('Request approved — they now have access to the group.')
    } catch (error: any) {
      console.error('Error approving join request:', error)
      showToast('Failed to approve request: ' + (error.message || 'Unknown error'))
    }
  }

  const handleRejectJoinRequest = async (requestId: number) => {
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

  // Runs server-side (remove_group_member) — it re-checks the $0 balance rule
  // itself rather than trusting the client, and flips status to 'removed'
  // instead of deleting the row, so their session/payment history is untouched.
  const handleRemoveMember = async (targetUserId: number) => {
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

  // Runs server-side (update_session_notes) — it re-checks that you're the
  // session's creator itself rather than trusting the client, since the
  // general "any member can update a session" rule doesn't apply to notes.
  const handleSaveNotes = async (sessionId: number) => {
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
            <div className="w-12" />
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
                ? 'Your request to delete this session was rejected — it was kept as-is.'
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

          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            You can edit the session again if needed.
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
                ? 'A group member wants to delete this session — every amount below is going to $0.'
                : 'This session has been edited. Review the changes below.'}
            </p>
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
                                className="text-sm font-semibold"
                                style={{ color: memberInfo.approvalRecord.old_amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
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

            {/* Highlight the current user's change summary — same inline old → new
                diff style as the "All changes" list above, not a separate
                previous/new/delta breakdown. */}
            {pendingApproval && (
              <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--border)' }}>
                <p className="eyebrow mb-1">Your change</p>
                <div className="ledger-row">
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Amount</span>
                  <div className="flex items-center gap-2 amount">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: pendingApproval.old_amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                    >
                      {pendingApproval.old_amount >= 0 ? '+' : ''}${pendingApproval.old_amount.toFixed(2)}
                    </span>
                    <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                    <span
                      className="text-sm font-semibold"
                      style={{ color: pendingApproval.new_amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                    >
                      {pendingApproval.new_amount >= 0 ? '+' : ''}${pendingApproval.new_amount.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleApproveEdit(pendingApproval.id, session.id)}
              className="btn-approve flex-1 py-3"
            >
              <Check size={18} /> {pendingApproval?.is_deletion ? 'Approve deletion' : 'Approve'}
            </button>
            <button
              onClick={() => handleRejectEdit(pendingApproval.id, session.id, pendingApproval.editor_user_id)}
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
          {sessionDetails.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No payments in this session.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {sessionDetails.map((detail) => {
                const member = members.find(m => m.user_id === detail.user_id)
                const displayName = member ? formatDisplayName(members, member) : detail.username
                return (
                  <div key={detail.user_id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-sm">{displayName}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{detail.username}</p>
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
          <div className="w-12"></div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col gap-6 md:flex-row md:gap-0">
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
              <h2 className="font-display text-2xl font-semibold mb-6">Dues</h2>

              {/* Your balance */}
              <div className="card mb-8 flex items-center justify-between gap-4">
                <div>
                  <p className="eyebrow mb-1 flex items-center gap-1.5">
                    Your balance
                    <InfoTooltip label="What this balance means">
                      A positive balance means the group owes you money; negative means you owe the
                      group. Recording a payment moves both numbers toward zero — it never moves money itself.
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
                                      ? s.pendingIsDeletion ? 'Someone wants to delete this — needs your review' : 'Needs your review'
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
                                    ? <>The request to delete &ldquo;{rn.session_description}&rdquo; was rejected by {rn.rejected_by_name || 'a member'} — it was kept</>
                                    : <>&ldquo;{rn.session_description}&rdquo; was rejected by {rn.rejected_by_name || 'a member'} — the edit did not go through</>}
                                </p>
                              </div>
                              <button
                                onClick={() => handleDismissRejectionNotice(rn.id)}
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
                                    ? <>The request to delete &ldquo;{pc.session_description}&rdquo; was cancelled — your review is no longer needed</>
                                    : <>Your review on &ldquo;{pc.session_description}&rdquo; was cancelled by the editor</>}
                                </p>
                              </div>
                              <button
                                onClick={() => handleDismissCancellation(pc.id)}
                                className="btn-secondary text-sm shrink-0"
                              >
                                Dismiss
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {activeTab === 'members' && (
            <div>
              <h2 className="font-display text-2xl font-semibold mb-6">Group Members</h2>

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
                        <div>
                          <p className="text-sm font-medium">{req.displayName}</p>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{req.username} · wants to join</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => handleApproveJoinRequest(req.id)} className="btn-primary text-sm">
                            Approve
                          </button>
                          <button onClick={() => handleRejectJoinRequest(req.id)} className="btn-secondary text-sm">
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
                                    className="w-full text-left px-4 py-2 transition-colors hover:bg-[var(--canvas)]"
                                  >
                                    <p className="font-medium text-sm">{formatDisplayName(members, member)}</p>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{member.username}</p>
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
                              <div className="flex-1">
                                {(() => {
                                  const member = members.find(m => m.user_id === sm.user_id)
                                  const displayName = member ? formatDisplayName(members, member) : sm.username
                                  return (
                                    <>
                                      <p className="font-medium text-sm">{displayName}</p>
                                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{sm.username}</p>
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
                                className="field amount w-24 px-2 py-1"
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
                      <button type="submit" className="btn-primary">
                        {editingSessionId ? 'Update session' : 'Create session'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddSession(false)
                          setSessionDescription('')
                          setSessionMembers([])
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
                        .filter(session => session.id !== editingSessionId)
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
                                    {session.pendingIsDeletion ? 'Cancel deletion request' : 'Cancel edit'}
                                  </button>
                                )}
                                {!session.is_live && !session.pendingApproval && !hasUndismissedRejection && !session.waitingForApproval && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditSession(session.id)
                                      }}
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
                                          <div>
                                            {(() => {
                                              const member = members.find(m => m.user_id === detail.user_id)
                                              const displayName = member ? formatDisplayName(members, member) : detail.username
                                              return (
                                                <>
                                                  <p className="font-medium text-sm">
                                                    {displayName}
                                                    {detail.user_id === userId && (
                                                      <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>(You)</span>
                                                    )}
                                                  </p>
                                                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>@{detail.username}</p>
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
                                      className="field amount flex-1"
                                      placeholder="0.00"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleAddToLiveSession(session.id)}
                                      className="btn-primary"
                                      disabled={liveSessionAmount === ''}
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
                const isDeletionRequest = sessions.find(s => s.id === confirmCancelEditSessionId)?.pendingIsDeletion
                return (
                  <div className="modal-overlay">
                    <div className="modal-panel">
                      <h3 className="font-display text-xl font-semibold mb-2">
                        {isDeletionRequest ? 'Cancel this deletion request?' : 'Cancel this edit?'}
                      </h3>
                      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                        {isDeletionRequest
                          ? 'The session will stay exactly as it is. Anyone who already approved or rejected the deletion will be notified that the request was cancelled.'
                          : 'The session will keep its current amounts. Anyone who already approved or rejected your changes will be notified that the edit was cancelled.'}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleCancelEdit(confirmCancelEditSessionId)}
                          className="btn-danger flex-1"
                        >
                          {isDeletionRequest ? 'Cancel deletion request' : 'Cancel edit'}
                        </button>
                        <button onClick={() => setConfirmCancelEditSessionId(null)} className="btn-secondary">
                          Keep waiting
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}

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
                        <button type="submit" className="btn-primary flex-1">
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
                    This records money you already sent outside the app (Venmo, cash, etc.) —
                    Dues doesn&apos;t move money itself. It won&apos;t affect either balance until the
                    other person confirms they received it — that way no one can clear their own
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
                      className="field amount"
                      placeholder="0.00"
                      required
                    />
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
                        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                          Dues doesn&apos;t move money — send it directly first, then record it below.
                        </p>
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
              onSaved={(message) => {
                showToast(message)
                loadMembers()
              }}
            />
          )}

          {activeTab === 'info' && (
            <div>
              <h2 className="font-display text-2xl font-semibold mb-6">{group.name || 'Group Info'}</h2>

              {/* Owner Information */}
              {isOwner && (
                <div className="mb-4">
                  <span className="badge badge-accent">Owner</span>
                </div>
              )}

              {/* Group Details */}
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

              {/* Group Pin — the ticket stub signature */}
              {group.pin && (
                <div>
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
                    <div className="flex gap-2">
                      <button onClick={() => setShowPin(!showPin)} className="btn-secondary text-sm">
                        {showPin ? 'Hide' : 'Show'}
                      </button>
                      <button onClick={handleCopyPin} className="btn-primary text-sm">
                        Copy
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

