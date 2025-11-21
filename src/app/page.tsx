'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthPanel from '@/components/AuthPanel'
import useAuth from '@/hooks/useAuth'
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

  const handleCreateGroup = async () => {
    const name = prompt('Enter group name:')
    if (!name || !user) return

    try {
      // Get or create user in User table
      console.log('Creating group - getting user ID for:', user.email)
      const dbUserId = await getOrCreateUser(user)
      if (!dbUserId) {
        console.error('Failed to get user ID. User:', user)
        alert('Failed to get user information. Please check the console for details.')
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

      // Ensure pin is unique
      while (pinExists && attempts < 10) {
        const { data: existingGroup } = await supabase
          .from('Group')
          .select('id')
          .eq('pin', pin)
          .maybeSingle()

        if (!existingGroup) {
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
    } catch (error) {
      console.error('Error creating group:', error)
      alert('Failed to create group')
    }
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

      // Find group by pin
      const { data: groupData, error: groupError } = await supabase
        .from('Group')
        .select('id, name')
        .eq('pin', joinPin.trim())
        .single()

      if (groupError || !groupData) {
        setJoinError('Invalid group pin. Please check and try again.')
        return
      }

      // Check if user is already a member
      const { data: existingMember } = await supabase
        .from('GroupMember')
        .select('*')
        .eq('id', groupData.id)
        .eq('user_id', dbUserId)
        .maybeSingle()

      if (existingMember) {
        setJoinError('You are already a member of this group')
        return
      }

      // Add user to group
      const { error: memberError } = await supabase
        .from('GroupMember')
        .insert([{
          id: groupData.id,
          user_id: dbUserId,
          role: 'member'
        }])

      if (memberError) {
        console.error('Error joining group:', memberError)
        setJoinError('Failed to join group. Please try again.')
        return
      }

      // Success - close modal and reload groups
      setShowJoinModal(false)
      setJoinPin('')
      setJoinError('')
      await loadGroups()
    } catch (error: any) {
      console.error('Error joining group:', error)
      setJoinError(error.message || 'Failed to join group')
    }
  }

  if (authLoading || (loading && user)) {
    return (
      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">Loading...</div>
        </div>
      </main>
    )
  }

  // Show landing page if user is not authenticated
  if (!user) {
    return (
      <main className="min-h-screen">
        <header className="border-b border-gray-300 bg-transparent">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-black">Dues</h1>
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-800 transition text-sm font-medium"
            >
              Log in
            </Link>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-6 py-16">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <h2 className="text-5xl font-bold text-black mb-4">
              Split Expenses, Track Dues
            </h2>
            <p className="text-xl text-gray-700 mb-8 max-w-2xl mx-auto">
              Manage group expenses and track who owes what. Create groups, add sessions, and keep everyone in sync.
            </p>
            <div className="flex justify-center">
              <Link
                href="/login?signup=true"
                className="px-8 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition text-lg font-medium"
              >
                Get Started
              </Link>
            </div>
          </div>

          {/* Features Section */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="border-2 border-gray-300 rounded-lg p-6 hover:shadow-lg transition">
              <div className="text-4xl mb-4">👥</div>
              <h3 className="text-xl font-semibold text-black mb-2">Create Groups</h3>
              <p className="text-gray-700">
                Organize expenses by group. Each group gets a unique pin for easy sharing.
              </p>
            </div>
            <div className="border-2 border-gray-300 rounded-lg p-6 hover:shadow-lg transition">
              <div className="text-4xl mb-4">💰</div>
              <h3 className="text-xl font-semibold text-black mb-2">Track Sessions</h3>
              <p className="text-gray-700">
                Add expense sessions and see who paid what. All amounts automatically balance to zero.
              </p>
            </div>
            <div className="border-2 border-gray-300 rounded-lg p-6 hover:shadow-lg transition">
              <div className="text-4xl mb-4">📊</div>
              <h3 className="text-xl font-semibold text-black mb-2">View Dues</h3>
              <p className="text-gray-700">
                See your outstanding balance at a glance. Know exactly what you owe or are owed.
              </p>
            </div>
          </div>

          {/* How It Works */}
          <div className="border-2 border-gray-300 rounded-lg p-8 bg-gray-50">
            <h3 className="text-2xl font-semibold text-black mb-6 text-center">How It Works</h3>
            <div className="grid md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3">1</div>
                <p className="text-sm text-gray-700">Create or join a group</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3">2</div>
                <p className="text-sm text-gray-700">Add expense sessions</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3">3</div>
                <p className="text-sm text-gray-700">Track who owes what</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3">4</div>
                <p className="text-sm text-gray-700">Settle up easily</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-300 bg-transparent">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-black">Dues</h1>
          <AuthPanel />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-black">My Groups</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowJoinModal(true)}
              className="px-4 py-2 border-2 border-gray-300 text-black rounded-lg hover:bg-gray-100 transition"
            >
              Join Group
            </button>
            <button
              onClick={handleCreateGroup}
              className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
            >
              + New Group
            </button>
          </div>
        </div>

        {showJoinModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 border-2 border-gray-300 shadow-lg">
              <h3 className="text-xl font-semibold mb-4 text-black">Join Group</h3>
              <form onSubmit={handleJoinGroup} className="space-y-4">
                <div>
                  <label htmlFor="joinPin" className="block text-sm font-medium mb-1 text-black">
                    Enter Group Pin
                  </label>
                  <input
                    id="joinPin"
                    type="text"
                    value={joinPin}
                    onChange={(e) => {
                      setJoinPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                      setJoinError('')
                    }}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none text-center text-2xl tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                  />
                  <p className="text-xs text-gray-600 mt-1">Enter the 6-digit pin provided by the group owner</p>
                </div>
                {joinError && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded text-sm">
                    {joinError}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowJoinModal(false)
                      setJoinPin('')
                      setJoinError('')
                    }}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition text-black"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {groups.length === 0 ? (
          <div className="text-center py-12">
            <p className="mb-4 text-gray-700">No groups yet.</p>
            <button
              onClick={handleCreateGroup}
              className="text-black underline font-medium"
            >
              Create your first group
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className={`block border-2 rounded-lg p-4 transition-transform duration-200 hover:scale-105 ${
                  group.role === 'owner'
                    ? 'border-yellow-500 hover:border-yellow-600'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg mb-1 text-black">{group.name || 'Untitled Group'}</h3>
                    <p className="text-sm text-gray-600">
                      {group.memberCount || 0} {group.memberCount === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  {group.role === 'owner' && (
                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium">
                      Owner
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
