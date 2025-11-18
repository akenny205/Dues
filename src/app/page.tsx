'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthPanel from '@/components/AuthPanel'
import useAuth from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

interface Group {
  id: number
  Description: string | null
  created_at: string
}

export default function HomePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

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
        console.log('Home page: No user or session, waiting 2 seconds before redirect...')
        setTimeout(async () => {
          const { data: { session: retrySession } } = await supabase.auth.getSession()
          console.log('Home page: Retry session check:', { session: !!retrySession })
          if (retrySession) {
            console.log('Home page: Session found on retry, loading groups')
            loadGroups()
          } else {
            console.log('Home page: Still no session after 2 seconds, redirecting to login')
            router.replace('/login')
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
  }, [user, authLoading, router])

  const loadGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('Session')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      // Map the data to match our interface
      const mappedData = (data || []).map((session: any) => ({
        id: session.id,
        Description: session.Description,
        created_at: session.created_at
      }))
      setGroups(mappedData)
    } catch (error) {
      console.error('Error loading groups:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateGroup = async () => {
    const name = prompt('Enter group name:')
    if (!name) return

    try {
      const { data, error } = await supabase
        .from('Session')
        .insert([{ Description: name }])
        .select()
        .single()

      if (error) throw error
      if (data) {
        const mappedData = {
          id: data.id,
          Description: data.Description,
          created_at: data.created_at
        }
        setGroups([mappedData, ...groups])
      }
    } catch (error) {
      console.error('Error creating group:', error)
      alert('Failed to create group')
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">Loading...</div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-gray-300">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-black">Dues</h1>
          <AuthPanel />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-black">My Groups</h2>
          <button
            onClick={handleCreateGroup}
            className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
          >
            + New Group
          </button>
        </div>

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
                className="block border-2 border-gray-300 rounded-lg p-4 hover:border-gray-400 transition"
              >
                <h3 className="font-semibold text-lg mb-1 text-black">{group.Description || 'Untitled Session'}</h3>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
