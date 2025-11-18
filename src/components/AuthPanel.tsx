'use client'

import Link from 'next/link'
import useAuth from '@/hooks/useAuth'

export default function AuthPanel() {
  const { user, loading, signOut } = useAuth()

  if (loading) return <div className="text-sm text-gray-700">Loading…</div>

  if (!user) {
    return (
      <Link
        href="/login"
        className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-800 transition text-sm font-medium"
      >
        Log in
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-black font-medium">{user.email}</span>
      <button
        onClick={signOut}
        className="px-3 py-2 rounded-lg border-2 border-gray-300 hover:bg-gray-100 transition text-sm text-black font-medium"
      >
        Log out
      </button>
    </div>
  )
}
