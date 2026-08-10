'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import AuthPanel from '@/components/AuthPanel'
import Skeleton from '@/components/Skeleton'
import ToastStack from '@/components/ToastStack'
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
  role?: string | null
  memberCount?: number
}

export default function HomePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [joinPin, setJoinPin] = useState('')
  const [joinError, setJoinError] = useState('')
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const { toasts, showToast, dismiss } = useToast()

  const loadGroups = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }

    try {
      // Get user ID first
      const dbUserId = await getOrCreateUser(user)
      if (!dbUserId) {
        console.error('Failed to get user ID')
        setLoading(false)
        return
      }

      // Get groups where user is a member (including role)
      const { data: memberData, error: memberError } = await supabase
        .from('GroupMember')
        .select('id, role, Group(*)')
        .eq('user_id', dbUserId)

      if (memberError) throw memberError

      // Extract groups from the joined data
      const groupsList: (Group | null)[] = (memberData || [])
        .map((member: any) => {
          const group = member.Group
          if (!group) return null
          return {
            id: group.id,
            name: group.name,
            created_at: group.created_at,
            created_by: group.created_by,
            pin: group.pin || null,
            role: member.role || null
          } as Group
        })
      
      const mappedData: Group[] = groupsList
        .filter((g): g is Group => g !== null)
        .sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
          return dateB - dateA
        })

      // Fetch member count for each group
      const groupsWithMemberCount = await Promise.all(
        mappedData.map(async (group) => {
          const { data: memberCountData, error: countError } = await supabase
            .from('GroupMember')
            .select('id')
            .eq('id', group.id)

          if (countError) {
            console.error('Error loading member count:', countError)
            return { ...group, memberCount: 0 }
          }

          return {
            ...group,
            memberCount: memberCountData?.length || 0
          }
        })
      )

      setGroups(groupsWithMemberCount)
    } catch (error) {
      console.error('Error loading groups:', error)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    // Handle email verification from URL hash
    if (typeof window !== 'undefined' && window.location.hash) {
      setTimeout(async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          window.history.replaceState(null, '', window.location.pathname)
        }
      }, 500)
    }

    if (authLoading) {
      console.log('Home page: Auth still loading...')
      return
    }

    // Check session directly if user state isn't updated yet
    const checkSession = async () => {
      // Give it more time for session to be established after redirect
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const { data: { session } } = await supabase.auth.getSession()
      console.log('Home page: Session check:', { session: !!session, user: !!user, sessionUser: session?.user?.email })
      
      if (session) {
        // Session exists - load groups even if user state hasn't updated yet
        console.log('Home page: Session found, loading groups')
        loadGroups()
        return
      }

      if (!user && !session) {
        // Wait longer in case session is still being established
        console.log('Home page: No user or session, waiting 2 seconds before showing landing page...')
        setTimeout(async () => {
          const { data: { session: retrySession } } = await supabase.auth.getSession()
          console.log('Home page: Retry session check:', { session: !!retrySession })
          if (retrySession) {
            console.log('Home page: Session found on retry, loading groups')
            loadGroups()
          } else {
            console.log('Home page: Still no session after 2 seconds, showing landing page')
            setLoading(false)
          }
        }, 2000)
        return
      }

      if (user) {
        console.log('Home page: User found, loading groups')
        loadGroups()
      }
    }

    checkSession()
  }, [user, authLoading, router, loadGroups])

  const handleCreateGroup = async (name: string) => {
    if (!name || !user) return

    try {
      // Get or create user in User table
      console.log('Creating group - getting user ID for:', user.email)
      const dbUserId = await getOrCreateUser(user)
      if (!dbUserId) {
        console.error('Failed to get user ID. User:', user)
        showToast('Failed to get user information. Please check the console for details.')
        return
      }
      console.log('Got user ID:', dbUserId)

      // Generate a unique 6-digit pin
      const generatePin = (): string => {
        return Math.floor(100000 + Math.random() * 900000).toString()
      }

      let pin = generatePin()
      let attempts = 0
      let pinExists = true

      // Ensure pin is unique. Groups are locked down to members-only in RLS, so
      // checking another group's pin — one we're not a member of — has to go
      // through this lookup function rather than a plain select.
      while (pinExists && attempts < 10) {
        const { data: existingGroups } = await supabase.rpc('find_group_by_pin', { input_pin: pin })

        if (!existingGroups || existingGroups.length === 0) {
          pinExists = false
        } else {
          pin = generatePin()
          attempts++
        }
      }

      const { data, error } = await supabase
        .from('Group')
        .insert([{ name, created_by: dbUserId, pin }])
        .select()
        .single()

      if (error) throw error
      if (data) {
        // Add creator as a group member with 'owner' role
        const { error: memberError } = await supabase
          .from('GroupMember')
          .insert([{
            id: data.id,
            user_id: dbUserId,
            role: 'owner'
          }])

        if (memberError) {
          console.error('Error adding creator as member:', memberError)
          // Continue anyway - group was created
        }

        // Reload groups to get the updated list
        await loadGroups()
      }
      setShowCreateGroupModal(false)
      setNewGroupName('')
    } catch (error) {
      console.error('Error creating group:', error)
      showToast('Failed to create group')
    }
  }

  const handleCreateGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newGroupName.trim()
    if (!trimmed) return
    handleCreateGroup(trimmed)
  }

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!joinPin || !user) return

    setJoinError('')
    
    try {
      // Get user ID
      const dbUserId = await getOrCreateUser(user)
      if (!dbUserId) {
        setJoinError('Failed to get user information')
        return
      }

      // Find group by pin — via a lookup function rather than a plain select,
      // since Group is locked down to members-only and we aren't one yet.
      const { data: groupRows, error: groupError } = await supabase.rpc('find_group_by_pin', {
        input_pin: joinPin.trim(),
      })
      const groupData = groupRows?.[0]

      if (groupError || !groupData) {
        setJoinError('Invalid group pin. Please check and try again.')
        return
      }

      // Check if user is already an active member (a removed member's row still
      // exists with status 'removed', so this has to check status specifically —
      // otherwise they'd be told they're "already a member" and blocked from
      // ever requesting to rejoin)
      const { data: existingMember } = await supabase
        .from('GroupMember')
        .select('status')
        .eq('id', groupData.id)
        .eq('user_id', dbUserId)
        .maybeSingle()

      if (existingMember && existingMember.status !== 'removed') {
        setJoinError('You are already a member of this group')
        return
      }

      // Check for an existing pending request instead of creating a duplicate
      const { data: existingRequest } = await supabase
        .from('JoinRequest')
        .select('id')
        .eq('group_id', groupData.id)
        .eq('user_id', dbUserId)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingRequest) {
        setJoinError('You already have a request pending for this group — waiting on the owner to approve it.')
        return
      }

      // Request to join — the group owner has to approve before you're actually
      // a member (see the Members tab's Pending Requests section for the other side).
      const { error: requestError } = await supabase
        .from('JoinRequest')
        .insert([{
          group_id: groupData.id,
          user_id: dbUserId,
        }])

      if (requestError) {
        console.error('Error requesting to join group:', requestError)
        setJoinError('Failed to send join request. Please try again.')
        return
      }

      // Success - close modal
      setShowJoinModal(false)
      setJoinPin('')
      setJoinError('')
      showToast(`Request sent to ${groupData.name || 'the group'}.`)
    } catch (error: any) {
      console.error('Error requesting to join group:', error)
      setJoinError(error.message || 'Failed to send join request')
    }
  }

  if (authLoading || (loading && user)) {
    return (
      <main className="min-h-screen">
        <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </header>

        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-7 w-32" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </div>

          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  // Show landing page if user is not authenticated
  if (!user) {
    const preview = [
      { name: 'Alex', amount: 42 },
      { name: 'Jordan', amount: -18.5 },
      { name: 'Sam', amount: -23.5 },
    ]

    return (
      <main className="min-h-screen">
        <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <h1 className="font-display text-xl font-semibold tracking-tight">Dues</h1>
            <Link href="/login" className="btn-primary text-sm">
              Log in
            </Link>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-6 pt-16 pb-24">
          {/* Hero Section */}
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center mb-24">
            <div>
              <p className="eyebrow mb-4">Group expenses, kept honest</p>
              <h2 className="font-display text-5xl sm:text-6xl font-semibold tracking-tight leading-[1.05] mb-6">
                Split evenly.<br />Settle simply.
              </h2>
              <p className="text-lg max-w-xl mb-8" style={{ color: 'var(--text-muted)' }}>
                Track group dues without the spreadsheet. Create a group, log who paid,
                and watch every balance settle to zero.
              </p>
              <Link href="/login?signup=true" className="btn-primary text-base px-6 py-3 inline-flex items-center gap-2">
                Get started <ArrowRight size={18} />
              </Link>
            </div>

            {/* Statement preview — the signature element */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <p className="eyebrow">Weekend trip</p>
                <span className="badge badge-outline">Statement</span>
              </div>
              <div>
                {preview.map((p) => (
                  <div key={p.name} className="ledger-row">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span
                      className="amount text-sm font-semibold"
                      style={{ color: p.amount >= 0 ? 'var(--accent)' : 'var(--negative)' }}
                    >
                      {p.amount >= 0 ? '+' : ''}${p.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-4 mt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                <span className="eyebrow">Balance</span>
                <span className="amount text-sm font-semibold">$0.00</span>
              </div>
            </div>
          </div>

          {/* Features Section */}
          <div className="grid md:grid-cols-3 gap-px mb-24 rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)', background: 'var(--border)' }}>
            {[
              { title: 'Create groups', body: 'Each group gets a unique pin members use to join.' },
              { title: 'Track sessions', body: 'Log who paid what. Splits always balance to zero.' },
              { title: 'View dues', body: 'See your current group balance.' },
            ].map((f) => (
              <div key={f.title} className="p-8" style={{ background: 'var(--surface)' }}>
                <h3 className="font-display text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{f.body}</p>
              </div>
            ))}
          </div>

          {/* How It Works */}
          <div>
            <p className="eyebrow mb-6 text-center">How it works</p>
            <div className="grid md:grid-cols-4 gap-8">
              {[
                'Create or join a group',
                'Add expense sessions',
                'Track who owes what',
                'Settle up easily',
              ].map((step, i) => (
                <div key={step} className="text-center">
                  <p className="font-display text-3xl font-semibold mb-2" style={{ color: 'var(--accent)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen">
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight">Dues</Link>
          <AuthPanel />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="font-display text-2xl font-semibold">My Groups</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowJoinModal(true)} className="btn-secondary">
              Request to join
            </button>
            <button onClick={() => setShowCreateGroupModal(true)} className="btn-primary">
              + New group
            </button>
          </div>
        </div>

        {showCreateGroupModal && (
          <div className="modal-overlay">
            <div className="modal-panel">
              <h3 className="font-display text-xl font-semibold mb-4">Name your group</h3>
              <form onSubmit={handleCreateGroupSubmit} className="space-y-4">
                <div>
                  <label htmlFor="newGroupName" className="block text-sm font-medium mb-1">
                    Group name
                  </label>
                  <input
                    id="newGroupName"
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="field"
                    placeholder="e.g., Roommates"
                    required
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary flex-1">
                    Create group
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateGroupModal(false)
                      setNewGroupName('')
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

        {showJoinModal && (
          <div className="modal-overlay">
            <div className="modal-panel">
              <h3 className="font-display text-xl font-semibold mb-4">Request to join a group</h3>
              <form onSubmit={handleJoinGroup} className="space-y-4">
                <div>
                  <label htmlFor="joinPin" className="block text-sm font-medium mb-1">
                    Group pin
                  </label>
                  <input
                    id="joinPin"
                    type="text"
                    value={joinPin}
                    onChange={(e) => {
                      setJoinPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                      setJoinError('')
                    }}
                    className="field amount text-center text-2xl tracking-[0.3em]"
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>The owner will need to approve your request.</p>
                </div>
                {joinError && (
                  <div className="p-3 rounded-md text-sm border" style={{ background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }}>
                    {joinError}
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary flex-1">
                    Send request
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowJoinModal(false)
                      setJoinPin('')
                      setJoinError('')
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

        {groups.length === 0 ? (
          <div className="card text-center py-16">
            <p className="mb-4" style={{ color: 'var(--text-muted)' }}>No groups yet.</p>
            <button onClick={() => setShowCreateGroupModal(true)} className="text-sm font-semibold hover:underline inline-flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
              Create your first group <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="card flex items-center justify-between transition-colors hover:border-[var(--accent)]"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-display font-semibold text-sm shrink-0"
                    style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                  >
                    {(group.name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold">{group.name || 'Untitled Group'}</h3>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {group.memberCount || 0} {group.memberCount === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                </div>
                {group.role === 'owner' && <span className="badge badge-accent">Owner</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </main>
  )
}
