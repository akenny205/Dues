'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useAuth from '@/hooks/useAuth'

export default function AuthPanel() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()

  if (loading) return <div className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</div>

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

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm hidden sm:inline" style={{ color: 'var(--ink-muted)' }}>{user.email}</span>
      <button onClick={handleSignOut} className="btn-secondary text-sm">
        Log out
      </button>
    </div>
  )
}
