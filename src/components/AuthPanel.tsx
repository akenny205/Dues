'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import useAuth from '@/hooks/useAuth'
import { getOrCreateUser } from '@/lib/userHelper'
import { supabase } from '@/lib/supabase'
import Avatar from './Avatar'
import ProfileModal from './ProfileModal'
import Link from 'next/link'

interface HeaderProfile {
  avatar_url: string | null
  first_name: string | null
  username: string | null
}

export default function AuthPanel() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const [dbUserId, setDbUserId] = useState<number | null>(null)
  const [profile, setProfile] = useState<HeaderProfile | null>(null)
  const [showProfile, setShowProfile] = useState(false)

  const loadHeaderProfile = async (id: number) => {
    const { data } = await supabase.from('User').select('avatar_url, first_name, username').eq('id', id).maybeSingle()
    if (data) setProfile(data)
  }

  useEffect(() => {
    if (!user) return
    let mounted = true
    getOrCreateUser(user).then((id) => {
      if (!mounted || !id) return
      setDbUserId(id)
      loadHeaderProfile(id)
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
    await signOut()
    // Redirect to home page (which will show landing page for unauthenticated users)
    router.push('/')
  }

  const displayName = profile?.first_name || profile?.username || user.email || 'Profile'

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleSignOut}
        className="text-xs font-medium hover:underline"
        style={{ color: 'var(--text-muted)' }}
      >
        Log out
      </button>
      <button
        onClick={() => dbUserId && setShowProfile(true)}
        disabled={!dbUserId}
        className="btn-secondary text-sm inline-flex items-center gap-2"
        title="Your profile"
      >
        <Avatar url={profile?.avatar_url} name={displayName} size={20} />
        <span className="hidden sm:inline">Profile</span>
      </button>
      {showProfile && dbUserId && (
        <ProfileModal
          userId={dbUserId}
          currentUserId={dbUserId}
          onClose={() => setShowProfile(false)}
          onSaved={() => loadHeaderProfile(dbUserId)}
        />
      )}
    </div>
  )
}
