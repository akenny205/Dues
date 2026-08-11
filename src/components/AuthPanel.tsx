'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import useAuth from '@/hooks/useAuth'
import { getOrCreateUser } from '@/lib/userHelper'
import { supabase } from '@/lib/supabase'
import Avatar from './Avatar'

interface HeaderProfile {
  avatar_url: string | null
  first_name: string | null
  username: string | null
}

export default function AuthPanel() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const [profile, setProfile] = useState<HeaderProfile | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (!user) return
    let mounted = true
    getOrCreateUser(user).then(async (id) => {
      if (!mounted || !id) return
      const { data } = await supabase.from('User').select('avatar_url, first_name, username').eq('id', id).maybeSingle()
      if (mounted && data) setProfile(data)
    })
    return () => {
      mounted = false
    }
  }, [user])

  if (loading) return <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>

  if (!user) {
    return (
      <Link href="/login" className="btn-primary text-sm">
        Log in
      </Link>
    )
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    await signOut()
    // Redirect to home page (which will show landing page for unauthenticated users)
    router.push('/')
  }

  const displayName = profile?.first_name || profile?.username || user.email || 'Profile'

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="text-xs font-medium hover:underline"
        style={{ color: 'var(--text-muted)' }}
      >
        Log out
      </button>
      <Link
        href="/profile"
        className="inline-flex rounded-full border transition-colors hover:border-[var(--accent)]"
        style={{ borderColor: 'var(--border)' }}
        title="Your profile"
      >
        <Avatar url={profile?.avatar_url} name={displayName} size={36} />
      </Link>
    </div>
  )
}
