'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session, User } from '@supabase/supabase-js'

export default function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // Set a timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      if (mounted) {
        console.warn('Auth loading timeout - setting loading to false')
        setLoading(false)
      }
    }, 10000) // 10 second timeout

    // Get initial session
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted) return
        clearTimeout(timeout)
        if (error) {
          console.error('Error getting session:', error)
          setLoading(false)
          return
        }
        setSession(data.session ?? null)
        setUser(data.session?.user ?? null)
        setLoading(false)
      })
      .catch((error) => {
        console.error('Error in getSession:', error)
        if (!mounted) return
        clearTimeout(timeout)
        setLoading(false)
      })

    // Listen for auth state changes (including OAuth callbacks and email verification)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
      
      // Handle sign in events (OAuth, email verification, password login)
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && newSession) {
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined }
    })
  }

  const signOut = async () => supabase.auth.signOut()

  return { user, session, loading, signInWithGoogle, signOut }
}
