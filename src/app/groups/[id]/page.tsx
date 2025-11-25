'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import useAuth from '@/hooks/useAuth'
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
  is_live?: boolean | null
  is_payment?: boolean | null
  memberCount?: number
  totalAmount?: number
  userPayment?: number | null
  pendingApproval?: boolean
  pendingRejection?: boolean
  waitingForApproval?: boolean // Editor is waiting for others to approve
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
  email?: string
  username?: string
  first_name?: string
  last_name?: string
}

// Helper function to format names: "First L." with last initial only if duplicate first names
const formatDisplayName = (members: GroupMember[], currentMember: GroupMember): string => {
  const firstName = currentMember.first_name || currentMember.username || 'Unknown'
  const lastName = currentMember.last_name || ''
  
  // Capitalize first letter of first name
  const capitalizedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
  
  // Check if there are duplicate first names in the group (case-insensitive comparison)
  const duplicateFirstNames = members.filter(m => {
    const otherFirstName = (m.first_name || m.username || '').toLowerCase()
    return otherFirstName === firstName.toLowerCase()
  }).length > 1
  
  if (duplicateFirstNames && lastName) {
    // Capitalize last initial
    const lastInitial = lastName.charAt(0).toUpperCase()
    return `${capitalizedFirstName} ${lastInitial}.`
  }
  
  return capitalizedFirstName
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
  const [showPin, setShowPin] = useState(false)
  const [activeTab, setActiveTab] = useState<'dues' | 'members' | 'sessions' | 'payments' | 'info'>('dues')
  const [paymentPayee, setPaymentPayee] = useState<number | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDescription, setPaymentDescription] = useState('')
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
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: number; session_id: number; editor_user_id: number; old_amount: number; new_amount: number; session_description: string }>>([])
  const [pendingRejections, setPendingRejections] = useState<Array<{ id: number; session_id: number; approver_user_id: number; session_description: string; approver_name?: string; approver_email?: string; rejected_at?: string }>>([])
  const [showNotification, setShowNotification] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [notificationType, setNotificationType] = useState<'approval' | 'rejection' | null>(null)
  const [originalPayments, setOriginalPayments] = useState<Array<{ user_id: number; amount: number }>>([])
  const [allSessionApprovals, setAllSessionApprovals] = useState<Array<{ user_id: number; old_amount: number; new_amount: number }>>([])
  const [editorUserId, setEditorUserId] = useState<number | null>(null)

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
      alert('Group not found')
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

  const loadMembers = useCallback(async () => {
    if (!groupId) return
    
    try {
      const { data: memberData, error } = await supabase
        .from('GroupMember')
        .select('*')
        .eq('id', groupId)
        .order('created_at', { ascending: true })

      if (error) throw error

      // Fetch user emails, usernames, and names
      const userIds = [...new Set((memberData || []).map((m: any) => m.user_id))]
      const userMap: Record<number, { email: string; username: string; first_name: string; last_name: string }> = {}
      
      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from('User')
          .select('id, email, username, first_name, last_name')
          .in('id', userIds)
        
        if (usersData) {
          usersData.forEach((u: any) => {
            userMap[u.id] = { 
              email: u.email || 'Unknown', 
              username: u.username || 'Unknown',
              first_name: u.first_name || '',
              last_name: u.last_name || ''
            }
          })
        }
      }

      const transformedMembers = (memberData || []).map((member: any) => ({
        id: member.id,
        user_id: member.user_id,
        role: member.role,
        created_at: member.created_at,
        email: userMap[member.user_id]?.email || 'Unknown',
        username: userMap[member.user_id]?.username || 'Unknown',
        first_name: userMap[member.user_id]?.first_name || '',
        last_name: userMap[member.user_id]?.last_name || ''
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
          const totalAmount = (paymentsData || []).reduce((sum, payment: any) => {
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
            waitingForApproval: waitingForApproval
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
          session_description: sessionMap[a.session_id] || 'Untitled Session'
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
            rejected_at: r.created_at || new Date().toISOString()
          }
        })

        setPendingRejections(formattedRejections)
      }

      // Determine notification type and message based on what notifications exist
      const hasApprovals = formattedApprovals && formattedApprovals.length > 0
      const hasRejections = formattedRejections && formattedRejections.length > 0
      
      if (hasApprovals && hasRejections) {
        // Multiple types - show generic message
        setShowNotification(true)
        setNotificationMessage(`You have ${formattedApprovals.length} pending approval${formattedApprovals.length === 1 ? '' : 's'} and ${formattedRejections.length} rejected edit${formattedRejections.length === 1 ? '' : 's'}`)
        setNotificationType(null) // Generic type
      } else if (hasApprovals) {
        // Only approvals - show specific message
        setShowNotification(true)
        setNotificationMessage(`You have ${formattedApprovals.length} pending session edit${formattedApprovals.length === 1 ? '' : 's'} to review`)
        setNotificationType('approval')
      } else if (hasRejections) {
        // Only rejections - show specific message
        setShowNotification(true)
        setNotificationMessage(`Your session edit${formattedRejections.length === 1 ? ' was' : 's were'} rejected`)
        setNotificationType('rejection')
      } else {
        // No notifications - hide if previously shown
        setShowNotification(false)
        setNotificationMessage('')
        setNotificationType(null)
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
        alert('This session has pending approvals. Please wait for all users to approve or reject the changes before editing again.')
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
      alert('Failed to load session: ' + (error.message || 'Unknown error'))
    }
  }

  const handleAddMemberToSession = (memberId?: number) => {
    // Find members not already in session
    const availableMembers = members.filter(
      m => !sessionMembers.some(sm => sm.user_id === m.user_id)
    )
    
    if (availableMembers.length === 0) {
      alert('All members are already added to the session')
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
        // All approvals are done, apply the changes
        const { data: approvedChanges } = await supabase
          .from('SessionEditApproval')
          .select('*')
          .eq('session_id', sessionId)
          .eq('status', 'approved')

        if (approvedChanges && approvedChanges.length > 0) {
          // Get the editor's proposed changes
          const editorId = approvedChanges[0].editor_user_id
          
          // Apply all approved changes
          for (const change of approvedChanges) {
            // Check if payment exists
            const { data: existingPayment } = await supabase
              .from('SessionPayment')
              .select('id')
              .eq('session_id', sessionId)
              .eq('user_id', change.approver_user_id)
              .maybeSingle()

            if (existingPayment) {
              // Update existing payment
              await supabase
                .from('SessionPayment')
                .update({ amount: change.new_amount })
                .eq('id', existingPayment.id)
            } else if (change.new_amount !== 0) {
              // Insert new payment if amount is not zero
              await supabase
                .from('SessionPayment')
                .insert([{
                  session_id: sessionId,
                  user_id: change.approver_user_id,
                  amount: change.new_amount
                }])
            } else {
              // If new amount is 0, delete the payment if it exists
              const { data: paymentToDelete } = await supabase
                .from('SessionPayment')
                .select('id')
                .eq('session_id', sessionId)
                .eq('user_id', change.approver_user_id)
                .maybeSingle()
              
              if (paymentToDelete) {
                await supabase
                  .from('SessionPayment')
                  .delete()
                  .eq('id', paymentToDelete.id)
              }
            }
          }

          // Delete all approval records for this session
          await supabase
            .from('SessionEditApproval')
            .delete()
            .eq('session_id', sessionId)

          alert('All changes have been approved and applied!')
        }
      } else {
        alert('Your approval has been recorded. Waiting for other users to approve.')
      }

      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
    } catch (error: any) {
      console.error('Error approving edit:', error)
      alert('Failed to approve edit: ' + (error.message || 'Unknown error'))
    }
  }

  const handleRejectEdit = async (approvalId: number, sessionId: number, editorUserId: number) => {
    try {
      // Update approval status to rejected
      const { error: updateError } = await supabase
        .from('SessionEditApproval')
        .update({ status: 'rejected' })
        .eq('id', approvalId)

      if (updateError) throw updateError

      // Delete all other pending approvals for this session (since one rejection cancels the edit)
      await supabase
        .from('SessionEditApproval')
        .delete()
        .eq('session_id', sessionId)
        .eq('status', 'pending')

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
            new_amount: 0
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

      alert('Edit rejected. The editor has been notified.')
      
      // Reload everything to show the rejection
      await loadSessions()
      await loadDues()
      await loadPendingApprovals()
    } catch (error: any) {
      console.error('Error rejecting edit:', error)
      alert('Failed to reject edit: ' + (error.message || 'Unknown error'))
    }
  }

  // Helper function to update session payments
  const updateSessionPayments = async (sessionId: number) => {
    // Get existing payments
    const { data: existingPayments } = await supabase
      .from('SessionPayment')
      .select('id, user_id')
      .eq('session_id', sessionId)

    // Delete payments that are no longer in the form
    const currentUserIds = new Set(sessionMembers.map(sm => sm.user_id))
    const paymentsToDelete = (existingPayments || []).filter(
      (ep: any) => !currentUserIds.has(ep.user_id)
    )

    if (paymentsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('SessionPayment')
        .delete()
        .in('id', paymentsToDelete.map((p: any) => p.id))

      if (deleteError) throw deleteError
    }

    // Update or insert payments
    for (const sm of sessionMembers) {
      const existingPayment = (existingPayments || []).find((ep: any) => ep.user_id === sm.user_id)
      
      if (existingPayment) {
        // Update existing payment
        const { error: updateError } = await supabase
          .from('SessionPayment')
          .update({ amount: parseFloat(sm.amount) })
          .eq('id', existingPayment.id)

        if (updateError) throw updateError
      } else {
        // Insert new payment
        const { error: insertError } = await supabase
          .from('SessionPayment')
          .insert([{
            session_id: sessionId,
            user_id: sm.user_id,
            amount: parseFloat(sm.amount)
          }])

        if (insertError) throw insertError
      }
    }
  }

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!groupId || !userId || sessionMembers.length === 0) return

    // Validate all amounts are filled
    const invalidMembers = sessionMembers.filter(sm => !sm.amount || isNaN(parseFloat(sm.amount)))
    if (invalidMembers.length > 0) {
      alert('Please enter valid amounts for all members')
      return
    }

    // Calculate sum of all amounts
    const total = sessionMembers.reduce((sum, sm) => {
      return sum + parseFloat(sm.amount || '0')
    }, 0)

    // Enforce that sum equals 0
    if (Math.abs(total) > 0.01) { // Allow small floating point differences
      alert(`The sum of all amounts must equal 0. Current sum: ${total.toFixed(2)}`)
      return
    }

    try {
      if (editingSessionId) {
        // Check if session is closed (not live)
        const { data: sessionData } = await supabase
          .from('Session')
          .select('is_live')
          .eq('id', editingSessionId)
          .single()

        const isClosedSession = !sessionData?.is_live

        if (isClosedSession) {
          // For closed sessions, track changes and create approval records
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

          // Also check for removed users (users in original but not in new)
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

          // Also check for added users (users in new but not in original)
          for (const sm of sessionMembers) {
            const wasInOriginal = originalPayments.some(op => op.user_id === sm.user_id)
            if (!wasInOriginal) {
              changedUsers.push({
                user_id: sm.user_id,
                old_amount: 0,
                new_amount: parseFloat(sm.amount || '0')
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
                alert(`Session edit saved! ${usersToNotify.length} user${usersToNotify.length === 1 ? '' : 's'} will be notified and must approve the changes before they take effect.`)
              } else {
                // Only the editor's value changed, so no approvals needed - update immediately
                await updateSessionPayments(editingSessionId)
                alert('Session updated successfully!')
              }
            } else {
              // No changes detected, update normally
              await updateSessionPayments(editingSessionId)
              alert('Session updated successfully!')
            }
          } else {
            // No changes detected, update normally
            await updateSessionPayments(editingSessionId)
            alert('Session updated successfully!')
          }
        } else {
          // Live session - update immediately
          await updateSessionPayments(editingSessionId)
          alert('Session updated successfully!')
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
            Description: sessionDescription || null
          }])
          .select('id')
          .single()

        if (sessionError) throw sessionError

        // Create session payments for each member
        const payments = sessionMembers.map(sm => ({
          session_id: sessionData.id,
          user_id: sm.user_id,
          amount: parseFloat(sm.amount)
        }))

        const { error: paymentsError } = await supabase
          .from('SessionPayment')
          .insert(payments)

        if (paymentsError) throw paymentsError

        alert('Session created successfully!')
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
      alert('Failed to save session: ' + (error.message || 'Unknown error'))
    }
  }

  const handleCreateLiveSession = async () => {
    if (!groupId) return

    const description = prompt('Enter session description (optional):')
    if (description === null) return // User cancelled

    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('Session')
        .insert([{
          group_id: groupId,
          Description: description || 'Live Session',
          is_live: true
        }])
        .select('id')
        .single()

      if (sessionError) throw sessionError

      await loadSessions()
      alert('Live session created! Members can now add their payments.')
    } catch (error: any) {
      console.error('Error creating live session:', error)
      alert('Failed to create live session: ' + (error.message || 'Unknown error'))
    }
  }

  const handleAddToLiveSession = async (sessionId: number) => {
    if (!userId || liveSessionAmount === '') return

    const amountValue = parseFloat(liveSessionAmount)
    if (isNaN(amountValue)) {
      alert('Please enter a valid amount')
      return
    }

    try {
      // Check if user already has a payment in this session
      const { data: existingPayment } = await supabase
        .from('SessionPayment')
        .select('id, amount')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .maybeSingle()

      if (existingPayment) {
        // Update existing payment
        const { error: updateError } = await supabase
          .from('SessionPayment')
          .update({ amount: amountValue })
          .eq('id', existingPayment.id)

        if (updateError) throw updateError
      } else {
        // Create new payment
        const { error: insertError } = await supabase
          .from('SessionPayment')
          .insert([{
            session_id: sessionId,
            user_id: userId,
            amount: amountValue
          }])

        if (insertError) throw insertError
      }

      // Close the form and reload sessions list to update stats
      setSelectedLiveSession(null)
      setLiveSessionAmount('')
      setSessionDetails([])
      await loadSessions()
    } catch (error: any) {
      console.error('Error adding to live session:', error)
      alert('Failed to add payment: ' + (error.message || 'Unknown error'))
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
      const total = (paymentsData || []).reduce((sum, payment: any) => {
        return sum + parseFloat(payment.amount?.toString() || '0')
      }, 0)

      // Check if sum equals 0
      if (Math.abs(total) > 0.01) {
        alert(`Cannot close session. The sum of all amounts must equal 0. Current sum: ${total.toFixed(2)}`)
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
      alert('Live session closed successfully!')
    } catch (error: any) {
      console.error('Error closing live session:', error)
      alert('Failed to close session: ' + (error.message || 'Unknown error'))
    }
  }

  const handleMakePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId || !groupId || !paymentPayee || !paymentAmount) return

    const amountValue = parseFloat(paymentAmount)
    if (isNaN(amountValue) || amountValue <= 0) {
      alert('Please enter a valid amount greater than 0')
      return
    }

    try {
      // Create a new session for this payment
      const payerName = formatDisplayName(members, members.find(m => m.user_id === userId) || { user_id: userId } as GroupMember)
      const payeeName = formatDisplayName(members, members.find(m => m.user_id === paymentPayee) || { user_id: paymentPayee } as GroupMember)
      
      const { data: sessionData, error: sessionError } = await supabase
        .from('Session')
        .insert([{
          group_id: groupId,
          Description: paymentDescription || `Payment from ${payerName} to ${payeeName}`,
          is_payment: true
        }])
        .select('id')
        .single()

      if (sessionError) throw sessionError

      // Create two session payments:
      // 1. Payer (negative amount - they're paying out)
      // 2. Payee (positive amount - they're receiving)
      const payments = [
        {
          session_id: sessionData.id,
          user_id: userId,
          amount: -amountValue // Negative for payer
        },
        {
          session_id: sessionData.id,
          user_id: paymentPayee,
          amount: amountValue // Positive for payee
        }
      ]

      const { error: paymentsError } = await supabase
        .from('SessionPayment')
        .insert(payments)

      if (paymentsError) throw paymentsError

      // Reset form and reload
      setPaymentPayee(null)
      setPaymentAmount('')
      setPaymentDescription('')
      await loadSessions()
      await loadDues()
      alert('Payment recorded successfully!')
    } catch (error: any) {
      console.error('Error making payment:', error)
      alert('Failed to record payment: ' + (error.message || 'Unknown error'))
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
    }
  }, [userId, groupId, loadGroup, loadDues, checkOwnership, loadMembers, loadSessions, loadPendingApprovals])

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
          const editorRecord = mappedApprovals.find(a => a.user_id === editorId)
          console.log('Editor record found:', editorRecord)
          
          setAllSessionApprovals(mappedApprovals.map(a => ({
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
      alert('Due marked as paid (removed from list)')
    } catch (error) {
      console.error('Error paying due:', error)
      alert('Failed to mark due as paid')
    }
  }

  const handleCopyPin = async () => {
    if (!group?.pin) return
    
    try {
      await navigator.clipboard.writeText(group.pin)
      alert('Group pin copied to clipboard!')
    } catch (error) {
      console.error('Failed to copy pin:', error)
      alert('Failed to copy pin. Please copy it manually.')
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">Loading...</div>
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

  // Calculate net balance for all members
  // Positive = user is owed money, Negative = user owes money
  const memberBalances = members.map(member => {
    const balance = dues
      .filter(d => d.user_id === member.user_id)
      .reduce((sum, d) => sum + d.amount, 0)
    return {
      ...member,
      balance
    }
  }).sort((a, b) => {
    // Sort: current user first, then by balance (owed money first, then those who owe)
    if (a.user_id === userId) return -1
    if (b.user_id === userId) return 1
    return b.balance - a.balance
  })

  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-300 bg-transparent">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-gray-700 hover:text-black font-medium">
            ← Back
          </Link>
          <h1 className="text-xl font-semibold text-black">{group.name || 'Untitled Group'}</h1>
          <div></div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 flex gap-6">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0">
          <div className="border-2 border-gray-300 rounded-lg p-2">
            <button
              onClick={() => setActiveTab('dues')}
              className={`w-full text-left px-4 py-2 rounded transition ${
                activeTab === 'dues'
                  ? 'bg-black text-white'
                  : 'text-black hover:bg-gray-100'
              }`}
            >
              Dues
            </button>
            <button
              onClick={() => setActiveTab('members')}
              className={`w-full text-left px-4 py-2 rounded transition mt-1 ${
                activeTab === 'members'
                  ? 'bg-black text-white'
                  : 'text-black hover:bg-gray-100'
              }`}
            >
              Group Members
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`w-full text-left px-4 py-2 rounded transition mt-1 ${
                activeTab === 'sessions'
                  ? 'bg-black text-white'
                  : 'text-black hover:bg-gray-100'
              }`}
            >
              Sessions
            </button>
            <button
              onClick={() => setActiveTab('payments')}
              className={`w-full text-left px-4 py-2 rounded transition mt-1 ${
                activeTab === 'payments'
                  ? 'bg-black text-white'
                  : 'text-black hover:bg-gray-100'
              }`}
            >
              Payments
            </button>
            <button
              onClick={() => setActiveTab('info')}
              className={`w-full text-left px-4 py-2 rounded transition mt-1 ${
                activeTab === 'info'
                  ? 'bg-black text-white'
                  : 'text-black hover:bg-gray-100'
              }`}
            >
              {group.name ? `${group.name} Info` : 'Group Info'}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1">
          {/* Notification Banner - Only show on Dues tab */}
          {activeTab === 'dues' && showNotification && (pendingApprovals.length > 0 || pendingRejections.length > 0) && (
            <div className={`mb-4 p-4 rounded-lg border-2 ${
              notificationType === 'approval' 
                ? 'bg-yellow-50 border-yellow-300' 
                : notificationType === 'rejection'
                ? 'bg-red-50 border-red-300'
                : 'bg-orange-50 border-orange-300' // Generic type (multiple notification types)
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-lg ${
                    notificationType === 'approval' 
                      ? 'text-yellow-800' 
                      : notificationType === 'rejection'
                      ? 'text-red-800'
                      : 'text-orange-800' // Generic type
                  }`}>
                    {notificationType === 'approval' 
                      ? '⚠️' 
                      : notificationType === 'rejection'
                      ? '❌'
                      : '🔔'} {/* Generic icon for multiple types */}
                  </span>
                  <p className={`font-medium ${
                    notificationType === 'approval' 
                      ? 'text-yellow-800' 
                      : notificationType === 'rejection'
                      ? 'text-red-800'
                      : 'text-orange-800' // Generic type
                  }`}>
                    {notificationMessage}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setActiveTab('sessions')
                      setShowNotification(false)
                      // Reload sessions to ensure rejection indicators are shown
                      await loadSessions()
                    }}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      notificationType === 'approval'
                        ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                        : notificationType === 'rejection'
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-orange-600 text-white hover:bg-orange-700' // Generic type
                    }`}
                  >
                    Review
                  </button>
                  <button
                    onClick={() => {
                      setShowNotification(false)
                      if (notificationType === 'rejection' || !notificationType) {
                        // Navigate to sessions tab for rejections or generic notifications
                        setActiveTab('sessions')
                      }
                    }}
                    className="px-4 py-2 rounded-lg border-2 border-gray-300 hover:bg-gray-100 transition text-black"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dues' && (
            <div className="mb-6">
              <h2 className="text-2xl font-semibold mb-6 text-black">Dues</h2>
              
              {memberBalances.length === 0 ? (
                <div className="border-2 border-gray-300 rounded-lg p-8 bg-white text-center">
                  <p className="text-gray-700">No members in this group yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {memberBalances.map((member) => {
                    const isCurrentUser = member.user_id === userId
                    const balance = member.balance
                    const displayName = formatDisplayName(members, member)
                    
                    return (
                      <div
                        key={member.user_id}
                        className={`border-2 rounded-lg p-6 bg-white ${
                          isCurrentUser
                            ? 'border-black border-4'
                            : 'border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              <p className={`font-semibold text-lg ${
                                isCurrentUser ? 'text-black' : 'text-black'
                              }`}>
                                {displayName}
                              </p>
                              {isCurrentUser && (
                                <span className="text-xs bg-black text-white px-2 py-1 rounded font-medium">
                                  You
                                </span>
                              )}
                              {member.role === 'owner' && (
                                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium">
                                  Owner
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600">@{member.username}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-700 mb-1 font-medium">Net Balance</p>
                            <p className={`text-3xl font-bold ${
                              balance > 0 
                                ? 'text-green-600' 
                                : balance < 0 
                                ? 'text-red-600' 
                                : 'text-black'
                            }`}>
                              {balance >= 0 ? '+' : ''}${(balance / 100).toFixed(2)}
                            </p>
                            {balance > 0 && (
                              <p className="text-xs text-green-600 mt-1">Owed money</p>
                            )}
                            {balance < 0 && (
                              <p className="text-xs text-red-600 mt-1">Owes money</p>
                            )}
                            {balance === 0 && (
                              <p className="text-xs text-gray-600 mt-1">Balanced</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            <div>
              <h2 className="text-2xl font-semibold mb-4 text-black">Group Members</h2>
              {members.length === 0 ? (
                <p className="text-gray-700">No members yet.</p>
              ) : (
                <div className="space-y-2">
                  {members.map((member) => (
                    <div
                      key={member.user_id}
                      className="border-2 border-gray-300 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-black">{formatDisplayName(members, member)}</p>
                          <p className="text-sm text-gray-600">@{member.username}</p>
                        </div>
                        {member.role === 'owner' && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium">
                            Owner
                          </span>
                        )}
                        {member.role === 'member' && (
                          <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded font-medium">
                            Member
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Joined {new Date(member.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'sessions' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-semibold text-black">Sessions</h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateLiveSession}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    + Create Live Session
                  </button>
                  <button
                    onClick={handleAddSessionClick}
                    className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
                  >
                    + Add Session
                  </button>
                </div>
              </div>

              {showAddSession && (
                <div className="mb-6 border-2 border-gray-300 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-4 text-black">
                    {editingSessionId ? 'Edit Session' : 'Create New Session'}
                  </h3>
                  <form onSubmit={handleCreateSession} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-black">Session Description (optional)</label>
                      <input
                        type="text"
                        value={sessionDescription}
                        onChange={(e) => setSessionDescription(e.target.value)}
                        className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                        placeholder="e.g., January 2024 Dues"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-black">Members & Amounts</label>
                        <div className="relative member-dropdown-container">
                          <button
                            type="button"
                            onClick={() => handleAddMemberToSession()}
                            className="text-sm px-3 py-1 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-black"
                          >
                            + Add Member
                          </button>
                          {showMemberDropdown && (
                            <div className="absolute right-0 mt-1 bg-white border-2 border-gray-300 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto min-w-[200px] member-dropdown-container">
                              {members
                                .filter(m => !sessionMembers.some(sm => sm.user_id === m.user_id))
                                .map((member) => (
                                  <button
                                    key={member.user_id}
                                    type="button"
                                    onClick={() => handleAddMemberToSession(member.user_id)}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-100 transition text-black"
                                  >
                                    <p className="font-medium">{formatDisplayName(members, member)}</p>
                                    <p className="text-xs text-gray-600">@{member.username}</p>
                                  </button>
                                ))}
                              {members.filter(m => !sessionMembers.some(sm => sm.user_id === m.user_id)).length === 0 && (
                                <p className="px-4 py-2 text-sm text-gray-600">All members added</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {sessionMembers.length === 0 ? (
                        <p className="text-sm text-gray-600">No members added yet</p>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {sessionMembers.map((sm) => (
                            <div
                              key={sm.user_id}
                              className="flex items-center gap-2 p-3 border-2 border-gray-300 rounded-lg"
                            >
                              <div className="flex-1">
                                {(() => {
                                  const member = members.find(m => m.user_id === sm.user_id)
                                  const displayName = member ? formatDisplayName(members, member) : sm.username
                                  return (
                                    <>
                                      <p className="font-medium text-black">{displayName}</p>
                                      <p className="text-xs text-gray-600">@{sm.username}</p>
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
                                className="w-24 border-2 border-gray-300 rounded-lg px-2 py-1 text-black focus:border-black focus:outline-none"
                                placeholder="0.00"
                                required
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveMemberFromSession(sm.user_id)}
                                className="px-3 py-1 text-red-600 hover:bg-red-50 rounded transition text-sm"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          </div>
                          <div className="mt-4 p-3 border-2 border-gray-300 rounded-lg bg-gray-50">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-black">Total Sum:</span>
                              <span className={`text-lg font-semibold ${
                                Math.abs(sessionMembers.reduce((sum, sm) => sum + parseFloat(sm.amount || '0'), 0)) < 0.01
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              }`}>
                                ${sessionMembers.reduce((sum, sm) => sum + parseFloat(sm.amount || '0'), 0).toFixed(2)}
                              </span>
                            </div>
                            {Math.abs(sessionMembers.reduce((sum, sm) => sum + parseFloat(sm.amount || '0'), 0)) >= 0.01 && (
                              <p className="text-xs text-red-600 mt-1">Sum must equal $0.00 to create session</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
                      >
                        {editingSessionId ? 'Update Session' : 'Create Session'}
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
                        className="px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-black"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {viewingSessionId ? (
                <div>
                  {(() => {
                    const session = sessions.find(s => s.id === viewingSessionId)
                    if (!session) return null
                    
                    const pendingApproval = pendingApprovals.find(pa => pa.session_id === session.id)
                    const pendingRejection = pendingRejections.find(pr => pr.session_id === session.id)
                    
                    // If this session has a pending rejection, show rejection details
                    if (pendingRejection && session.pendingRejection) {
                      return (
                        <>
                          <div className="flex items-center justify-between mb-4">
                            <button
                              onClick={() => setViewingSessionId(null)}
                              className="text-gray-700 hover:text-black font-medium flex items-center gap-2"
                            >
                              ← Back to Sessions
                            </button>
                          </div>
                          
                          <div className="border-2 border-red-500 bg-red-50 rounded-lg p-6">
                            <div className="mb-4">
                              <h2 className="text-2xl font-semibold text-black mb-2">
                                ❌ Session Edit Rejected
                              </h2>
                              <p className="text-gray-700 mb-4">
                                Your edit to this session was rejected by a group member.
                              </p>
                            </div>
                            
                            <div className="border-2 border-gray-300 rounded-lg p-4 bg-white mb-4">
                              <h3 className="font-semibold text-black mb-3">
                                {session.Description || 'Untitled Session'}
                              </h3>
                              <div className="space-y-3">
                                <div className="flex items-center justify-between p-3 bg-red-50 rounded">
                                  <span className="text-sm font-medium text-gray-700">Rejected by:</span>
                                  <span className="font-semibold text-black">
                                    {pendingRejection.approver_name || 'Unknown'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                                  <span className="text-sm text-gray-700">Email:</span>
                                  <span className="text-sm text-black">
                                    {pendingRejection.approver_email || 'Unknown'}
                                  </span>
                                </div>
                                {pendingRejection.rejected_at && (
                                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                                    <span className="text-sm text-gray-700">Rejected on:</span>
                                    <span className="text-sm text-black">
                                      {new Date(pendingRejection.rejected_at).toLocaleString()}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="bg-white border-2 border-gray-300 rounded-lg p-4 mb-4">
                              <p className="text-sm text-gray-700 mb-2">
                                The changes you made to this session were not approved. You can edit the session again if needed.
                              </p>
                            </div>
                            
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
                                        alert('Failed to dismiss rejection. Please try again.')
                                        return
                                      }
                                    } else if (dismissError) {
                                      console.error('Error dismissing rejection:', dismissError)
                                      alert('Failed to dismiss rejection. Please try again.')
                                      return
                                    }
                                    
                                    // Close the rejection details view immediately
                                    setViewingSessionId(null)
                                    
                                    // Remove from pendingRejections state immediately for better UX
                                    setPendingRejections(prev => prev.filter(pr => pr.id !== pendingRejection.id))
                                    
                                    // Reload sessions and pending approvals to update the UI
                                    await loadSessions()
                                    await loadPendingApprovals()
                                    
                                    // Hide notification if there are no more rejections
                                    const { data: remainingRejections, error: checkError } = await supabase
                                      .from('SessionEditApproval')
                                      .select('id')
                                      .eq('editor_user_id', userId)
                                      .eq('status', 'rejected')
                                    
                                    // If dismissed_at column exists, filter by it
                                    let finalRemainingRejections = remainingRejections
                                    if (!checkError && remainingRejections) {
                                      // Try to filter by dismissed_at if column exists
                                      const { data: filteredRejections } = await supabase
                                        .from('SessionEditApproval')
                                        .select('id')
                                        .eq('editor_user_id', userId)
                                        .eq('status', 'rejected')
                                        .is('dismissed_at', null)
                                      
                                      if (!filteredRejections || filteredRejections.length === 0) {
                                        finalRemainingRejections = []
                                      }
                                    }
                                    
                                    if (!finalRemainingRejections || finalRemainingRejections.length === 0) {
                                      setShowNotification(false)
                                      setNotificationMessage('')
                                      setNotificationType(null)
                                    }
                                  } catch (error: any) {
                                    console.error('Error dismissing rejection:', error)
                                    alert('Failed to dismiss rejection: ' + (error.message || 'Unknown error'))
                                  }
                                }
                              }}
                              className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition font-medium"
                            >
                              OK
                            </button>
                          </div>
                        </>
                      )
                    }
                    
                    // If this session has a pending approval, show approval UI
                    if (pendingApproval && session.pendingApproval) {
                      return (
                        <>
                          <div className="flex items-center justify-between mb-4">
                            <button
                              onClick={() => setViewingSessionId(null)}
                              className="text-gray-700 hover:text-black font-medium flex items-center gap-2"
                            >
                              ← Back to Sessions
                            </button>
                          </div>
                          
                          <div className="border-2 border-yellow-500 bg-yellow-50 rounded-lg p-6">
                            <div className="mb-4">
                              <h2 className="text-2xl font-semibold text-black mb-2">
                                ⚠️ Pending Approval Required
                              </h2>
                              <p className="text-gray-700 mb-4">
                                This session has been edited. Your approval is required before the changes take effect.
                              </p>
                            </div>
                            
                            <div className="border-2 border-gray-300 rounded-lg p-4 bg-white mb-4">
                              <h3 className="font-semibold text-black mb-3">
                                {session.Description || 'Untitled Session'}
                              </h3>
                              
                              {/* Show all members' changes */}
                              <div className="mb-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-2">All Changes:</h4>
                                <div className="space-y-2">
                                  {(() => {
                                    // Debug: Log current state
                                    console.log('Rendering approval UI - allSessionApprovals:', allSessionApprovals)
                                    console.log('Rendering approval UI - sessionDetails:', sessionDetails)
                                    console.log('Rendering approval UI - members:', members)
                                    // Combine all members: those with approval records and those in current session
                                    const allMemberIds = new Set<number>()
                                    
                                    // Add all members who have approval records (they have changes)
                                    allSessionApprovals.forEach(a => {
                                      console.log('Adding member from approval record:', a.user_id)
                                      allMemberIds.add(a.user_id)
                                    })
                                    
                                    // Add all members currently in the session
                                    sessionDetails.forEach(d => {
                                      console.log('Adding member from session details:', d.user_id)
                                      allMemberIds.add(d.user_id)
                                    })
                                    
                                    console.log('All member IDs to show:', Array.from(allMemberIds))
                                    console.log('All session approvals:', allSessionApprovals)
                                    console.log('Editor user ID:', editorUserId)
                                    
                                    // Editor's change is now included in allSessionApprovals (with status 'approved')
                                    // No need to calculate it separately
                                    
                                    // Create a combined list showing all members
                                    const allMembersToShow = Array.from(allMemberIds).map(memberUserId => {
                                      const approvalRecord = allSessionApprovals.find(a => a.user_id === memberUserId)
                                      const sessionDetail = sessionDetails.find(d => d.user_id === memberUserId)
                                      const member = members.find(m => m.user_id === memberUserId)
                                      
                                      console.log(`Processing member ${memberUserId}:`, {
                                        hasApprovalRecord: !!approvalRecord,
                                        approvalRecord,
                                        sessionDetail,
                                        member
                                      })
                                      
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
                                    
                                    console.log('All members to show:', allMembersToShow)
                                    
                                    if (allMembersToShow.length === 0) {
                                      return <p className="text-sm text-gray-600">Loading session details...</p>
                                    }
                                    
                                    return allMembersToShow.map((memberInfo) => {
                                      const isCurrentUser = memberInfo.user_id === userId
                                      
                                      return (
                                        <div
                                          key={memberInfo.user_id}
                                          className={`flex items-center justify-between p-3 rounded ${
                                            isCurrentUser
                                              ? 'bg-yellow-100 border-2 border-yellow-400'
                                              : memberInfo.hasChange
                                              ? 'bg-blue-50 border border-blue-200'
                                              : 'bg-gray-50'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-black">
                                              {memberInfo.displayName}
                                            </span>
                                            {isCurrentUser && (
                                              <span className="text-xs bg-yellow-600 text-white px-2 py-0.5 rounded font-medium">
                                                You
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {memberInfo.approvalRecord ? (
                                              <>
                                                <span className={`text-sm font-semibold ${
                                                  memberInfo.approvalRecord.old_amount >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                  {memberInfo.approvalRecord.old_amount >= 0 ? '+' : ''}${memberInfo.approvalRecord.old_amount.toFixed(2)}
                                                </span>
                                                <span className="text-xs text-gray-500">→</span>
                                                <span className={`text-sm font-semibold ${
                                                  memberInfo.approvalRecord.new_amount >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                  {memberInfo.approvalRecord.new_amount >= 0 ? '+' : ''}${memberInfo.approvalRecord.new_amount.toFixed(2)}
                                                </span>
                                              </>
                                            ) : (
                                              <>
                                                <span className={`text-sm font-semibold ${
                                                  memberInfo.currentAmount >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                  {memberInfo.currentAmount >= 0 ? '+' : ''}${memberInfo.currentAmount.toFixed(2)}
                                                </span>
                                                {memberInfo.currentAmount !== 0 && (
                                                  <span className="text-xs text-gray-400">(no change)</span>
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
                              
                              {/* Highlight the current user's change summary */}
                              {pendingApproval && (
                                <div className="border-t-2 border-gray-300 pt-3 mt-3">
                                  <h4 className="text-sm font-medium text-black mb-2">Your Change Summary:</h4>
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                      <span className="text-sm text-gray-700">Previous Amount:</span>
                                      <span className={`font-semibold ${
                                        pendingApproval.old_amount >= 0 ? 'text-green-600' : 'text-red-600'
                                      }`}>
                                        {pendingApproval.old_amount >= 0 ? '+' : ''}${pendingApproval.old_amount.toFixed(2)}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                                      <span className="text-sm text-gray-700">New Amount:</span>
                                      <span className={`font-semibold ${
                                        pendingApproval.new_amount >= 0 ? 'text-green-600' : 'text-red-600'
                                      }`}>
                                        {pendingApproval.new_amount >= 0 ? '+' : ''}${pendingApproval.new_amount.toFixed(2)}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between p-2 bg-gray-100 rounded">
                                      <span className="text-sm font-medium text-black">Change:</span>
                                      <span className={`font-semibold ${
                                        pendingApproval.new_amount - pendingApproval.old_amount >= 0
                                          ? 'text-green-600'
                                          : 'text-red-600'
                                      }`}>
                                        {pendingApproval.new_amount - pendingApproval.old_amount >= 0 ? '+' : ''}
                                        ${(pendingApproval.new_amount - pendingApproval.old_amount).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            <div className="flex gap-3">
                              <button
                                onClick={() => handleApproveEdit(pendingApproval.id, session.id)}
                                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium flex items-center justify-center gap-2"
                              >
                                ✓ Approve
                              </button>
                              <button
                                onClick={() => handleRejectEdit(pendingApproval.id, session.id, pendingApproval.editor_user_id)}
                                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium flex items-center justify-center gap-2"
                              >
                                ✗ Reject
                              </button>
                            </div>
                          </div>
                        </>
                      )
                    }
                    
                    const totalAmount = sessionDetails.reduce((sum, detail) => sum + Math.abs(detail.amount), 0)
                    
                    return (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <button
                            onClick={() => setViewingSessionId(null)}
                            className="text-gray-700 hover:text-black font-medium flex items-center gap-2"
                          >
                            ← Back to Sessions
                          </button>
                          {!session.pendingApproval && (
                            <button
                              onClick={() => handleEditSession(session.id)}
                              className="px-3 py-1 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-sm text-black"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                        
                        <div className="border-2 border-gray-300 rounded-lg p-6">
                          <div className="flex items-center gap-3 mb-2">
                            <h2 className="text-2xl font-semibold text-black">
                              {session.Description || 'Untitled Session'}
                            </h2>
                            {!session.is_live && (session.Description?.includes('Live Session') || session.Description === 'Live Session') && (
                              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-medium flex items-center gap-1">
                                <span>📋</span>
                                Previously Live Session
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mb-6">
                            {new Date(session.created_at).toLocaleDateString()}
                          </p>
                          
                          <div className="mb-6 grid grid-cols-2 gap-4">
                            <div className="border-2 border-gray-300 rounded-lg p-4">
                              <p className="text-sm text-gray-700 mb-1 font-medium">Members</p>
                              <p className="text-2xl font-semibold text-black">{sessionDetails.length}</p>
                            </div>
                            <div className="border-2 border-gray-300 rounded-lg p-4">
                              <p className="text-sm text-gray-700 mb-1 font-medium">Total Amount</p>
                              <p className="text-2xl font-semibold text-black">${totalAmount.toFixed(2)}</p>
                            </div>
                          </div>
                          
                          <div>
                            <h3 className="text-lg font-semibold mb-4 text-black">Member Payments</h3>
                            {sessionDetails.length === 0 ? (
                              <p className="text-gray-700">No payments in this session.</p>
                            ) : (
                              <div className="space-y-2">
                                {sessionDetails.map((detail) => {
                                  const member = members.find(m => m.user_id === detail.user_id)
                                  const displayName = member ? formatDisplayName(members, member) : detail.username
                                  return (
                                    <div
                                      key={detail.user_id}
                                      className="border-2 border-gray-300 rounded-lg p-4 flex items-center justify-between"
                                    >
                                      <div>
                                        <p className="font-medium text-black">{displayName}</p>
                                        <p className="text-xs text-gray-600">@{detail.username}</p>
                                      </div>
                                    <p className={`text-lg font-semibold ${
                                      detail.amount >= 0 ? 'text-green-600' : 'text-red-600'
                                    }`}>
                                      {detail.amount >= 0 ? '+' : ''}${detail.amount.toFixed(2)}
                                    </p>
                                  </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              ) : (
                <>
                  {sessions.length === 0 ? (
                    <p className="text-gray-700">No sessions yet.</p>
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
                              if (session.pendingApproval && pendingApproval) {
                                // Show approval UI instead of viewing session
                                setViewingSessionId(session.id)
                                setActiveTab('sessions')
                              } else if (hasUndismissedRejection) {
                                // Show rejection details for editor
                                setViewingSessionId(session.id)
                                setActiveTab('sessions')
                              } else if (session.is_live) {
                                handleOpenLiveSession(session.id)
                              } else {
                                handleViewSession(session.id)
                              }
                            }}
                            className={`border-2 rounded-lg p-4 transition-transform duration-200 hover:scale-105 cursor-pointer ${
                              session.pendingApproval
                                ? 'border-yellow-500 bg-yellow-50'
                                : hasUndismissedRejection
                                ? 'border-red-500 bg-red-50'
                                : session.waitingForApproval
                                ? 'border-orange-500 bg-orange-50'
                                : session.is_live
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-black">
                                    {session.Description || 'Untitled Session'}
                                  </p>
                                  {session.is_payment && (
                                    <span className="text-sm" title="Payment Session">✉️</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-4 mt-1 flex-wrap">
                                  <p className="text-sm text-gray-600">
                                    {new Date(session.created_at).toLocaleDateString()}
                                  </p>
                                  <p className="text-sm text-gray-600">
                                    {session.memberCount || 0} {session.memberCount === 1 ? 'member' : 'members'}
                                  </p>
                                  <p className="text-sm font-medium text-black">
                                    Total: ${(session.totalAmount || 0).toFixed(2)}
                                  </p>
                                  {session.userPayment !== null && session.userPayment !== undefined && (
                                    <p className={`text-sm font-semibold ${
                                      session.userPayment >= 0 ? 'text-green-600' : 'text-red-600'
                                    }`}>
                                      {session.userPayment >= 0 ? 'Received' : 'Sent'}: ${Math.abs(session.userPayment).toFixed(2)}
                                    </p>
                                  )}
                                  {session.is_live && (
                                    <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-medium">
                                      LIVE
                                    </span>
                                  )}
                                  {session.is_payment && (
                                    <span className="text-xs bg-gray-600 text-white px-2 py-1 rounded font-medium flex items-center gap-1">
                                      <span>✉️</span>
                                      Payment
                                    </span>
                                  )}
                                  {session.pendingApproval && (
                                    <span className="text-xs bg-yellow-600 text-white px-2 py-1 rounded font-medium">
                                      ⚠️ Pending Approval
                                    </span>
                                  )}
                                  {hasUndismissedRejection && (
                                    <span className="text-xs bg-red-600 text-white px-2 py-1 rounded font-medium flex items-center gap-1">
                                      <span>❌</span>
                                      <span>Edit Rejected</span>
                                    </span>
                                  )}
                                  {session.waitingForApproval && (
                                    <span className="text-xs bg-orange-600 text-white px-2 py-1 rounded font-medium">
                                      ⏳ Waiting for Approval
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {session.is_live && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleCloseLiveSession(session.id)
                                    }}
                                    className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
                                  >
                                    Close Session
                                  </button>
                                )}
                                {!session.is_live && !session.pendingApproval && !hasUndismissedRejection && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleEditSession(session.id)
                                    }}
                                    className="ml-4 px-3 py-1 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-sm text-black"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>
                            </div>
                            {selectedLiveSession === session.id && (
                              <div className="mt-4 pt-4 border-t-2 border-gray-300" onClick={(e) => e.stopPropagation()}>
                                <h4 className="text-sm font-semibold mb-3 text-black">Live Session Payments</h4>
                                
                                {/* Show all payments */}
                                {sessionDetails.length > 0 && (
                                  <div className="mb-4">
                                    <p className="text-xs font-medium text-gray-700 mb-2">Current Payments:</p>
                                    <div className="space-y-2">
                                      {sessionDetails.map((detail) => (
                                        <div
                                          key={detail.user_id}
                                          className={`border-2 rounded-lg p-3 flex items-center justify-between ${
                                            detail.user_id === userId
                                              ? 'border-blue-500 bg-blue-50'
                                              : 'border-gray-300 bg-gray-50'
                                          }`}
                                        >
                                          <div>
                                            {(() => {
                                              const member = members.find(m => m.user_id === detail.user_id)
                                              const displayName = member ? formatDisplayName(members, member) : detail.username
                                              return (
                                                <>
                                                  <p className="font-medium text-black">
                                                    {displayName}
                                                    {detail.user_id === userId && (
                                                      <span className="text-xs text-blue-600 ml-2">(You)</span>
                                                    )}
                                                  </p>
                                                  <p className="text-xs text-gray-600">@{detail.username}</p>
                                                </>
                                              )
                                            })()}
                                          </div>
                                          <p className={`text-sm font-semibold ${
                                            detail.amount >= 0 ? 'text-green-600' : 'text-red-600'
                                          }`}>
                                            {detail.amount >= 0 ? '+' : ''}${detail.amount.toFixed(2)}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* User's payment input */}
                                <div>
                                  <p className="text-xs font-medium text-gray-700 mb-2">Your Payment:</p>
                                  <div className="flex gap-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={liveSessionAmount}
                                      onChange={(e) => setLiveSessionAmount(e.target.value)}
                                      className="flex-1 border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                                      placeholder="0.00"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleAddToLiveSession(session.id)}
                                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
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
                                      className="px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-black"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>

                                {/* Show current total */}
                                {sessionDetails.length > 0 && (
                                  <div className="mt-3 p-2 border-2 border-gray-300 rounded-lg bg-gray-50">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-black">Current Total:</span>
                                      <span className={`text-sm font-semibold ${
                                        Math.abs(sessionDetails.reduce((sum, d) => sum + d.amount, 0)) < 0.01
                                          ? 'text-green-600'
                                          : 'text-red-600'
                                      }`}>
                                        ${sessionDetails.reduce((sum, d) => sum + d.amount, 0).toFixed(2)}
                                      </span>
                                    </div>
                                    {Math.abs(sessionDetails.reduce((sum, d) => sum + d.amount, 0)) >= 0.01 && (
                                      <p className="text-xs text-red-600 mt-1">Sum must equal $0.00 to close session</p>
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
              )}
            </div>
          )}

          {activeTab === 'payments' && (
            <div>
              <h2 className="text-2xl font-semibold mb-4 text-black">Make a Payment</h2>
              
              <form onSubmit={handleMakePayment} className="border-2 border-gray-300 rounded-lg p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-black">
                    Pay To
                  </label>
                  <select
                    value={paymentPayee || ''}
                    onChange={(e) => setPaymentPayee(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                    required
                  >
                    <option value="">Select a member</option>
                    {members
                      .filter(m => m.user_id !== userId)
                      .map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {formatDisplayName(members, member)} (@{member.username})
                        </option>
                      ))}
                  </select>
                  {members.filter(m => m.user_id !== userId).length === 0 && (
                    <p className="text-sm text-gray-600 mt-1">No other members in this group</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-black">
                    Amount ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                    placeholder="0.00"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-black">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={paymentDescription}
                    onChange={(e) => setPaymentDescription(e.target.value)}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                    placeholder="e.g., Payment for dinner"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
                    disabled={!paymentPayee || !paymentAmount || members.filter(m => m.user_id !== userId).length === 0}
                  >
                    Record Payment
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentPayee(null)
                      setPaymentAmount('')
                      setPaymentDescription('')
                    }}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-black"
                  >
                    Clear
                  </button>
                </div>
              </form>

              <div className="mt-6 border-2 border-gray-300 rounded-lg p-4 bg-gray-50">
                <h3 className="text-sm font-semibold mb-2 text-black">How it works:</h3>
                <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                  <li>Select a member to pay</li>
                  <li>Enter the payment amount</li>
                  <li>A session will be created with two payments: one for you (negative) and one for the recipient (positive)</li>
                  <li>The payment will appear in the Sessions tab</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'info' && (
            <div>
              <h2 className="text-2xl font-semibold mb-4 text-black">{group.name || 'Group Info'}</h2>
              
              {/* Owner Information */}
              {isOwner && (
                <div className="mb-6 border-2 border-gray-300 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-3 text-black">Owner Information</h3>
                  <p className="text-sm text-gray-700">You are the owner of this group.</p>
                </div>
              )}

              {/* Group Details */}
              <div className="mb-6 border-2 border-gray-300 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3 text-black">Group Details</h3>
                <div className="space-y-2">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-black">Created:</span>{' '}
                    {new Date(group.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-black">Members:</span> {members.length}
                  </p>
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-black">Sessions:</span> {sessions.length}
                  </p>
                </div>
              </div>

              {/* Group Pin - Visible to all members */}
              {group.pin && (
                <div className="border-2 border-gray-300 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-3 text-black">Group Pin</h3>
                  <p className="text-sm text-gray-700 mb-3">Share this pin with others so they can join your group:</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 p-4 bg-gray-50 rounded-lg border-2 border-gray-300">
                      <p className="text-center text-3xl font-mono font-bold text-black tracking-widest">
                        {showPin ? group.pin : '••••••'}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowPin(!showPin)}
                      className="px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-sm text-black"
                    >
                      {showPin ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={handleCopyPin}
                      className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition text-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

