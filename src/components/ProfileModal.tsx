'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getPayLinks, hasAnyPaymentMethod } from '@/lib/paymentLinks'
import Avatar from './Avatar'

interface ProfileRow {
  first_name: string | null
  last_name: string | null
  username: string | null
  email: string | null
  avatar_url: string | null
  venmo_username: string | null
  cashapp_cashtag: string | null
  paypal_username: string | null
  zelle_handle: string | null
}

interface ProfileModalProps {
  userId: number
  currentUserId: number
  onClose: () => void
  // Pre-fills the amount/note on this person's pay links — used when opened
  // from the "Make a payment" flow with an amount already typed in.
  amount?: number
  note?: string
}

// Shows one group-mate's photo, name, and payment methods as quick-pay
// links. Viewing your own (userId === currentUserId) has nothing to show
// here — it sends you to the full /profile page instead of duplicating its
// editing UI in a modal.
export default function ProfileModal({ userId, currentUserId, onClose, amount, note }: ProfileModalProps) {
  const router = useRouter()
  const isSelf = userId === currentUserId

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [zelleCopied, setZelleCopied] = useState(false)

  useEffect(() => {
    if (isSelf) {
      onClose()
      router.push('/profile')
      return
    }
    let mounted = true
    supabase
      .from('User')
      .select('first_name, last_name, username, email, avatar_url, venmo_username, cashapp_cashtag, paypal_username, zelle_handle')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }: { data: ProfileRow | null }) => {
        if (!mounted) return
        setProfile(data)
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [userId, isSelf, router, onClose])

  if (isSelf) return null

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || 'Unknown'
    : '…'

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-w-md">
        {loading || !profile ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : (
          <>
            <div className="flex flex-col items-center text-center mb-6">
              <Avatar url={profile.avatar_url} name={displayName} size={80} className="mb-3" />
              <h3 className="font-display text-xl font-semibold">{displayName}</h3>
              {profile.username && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>@{profile.username}</p>
              )}
            </div>

            <p className="eyebrow mb-3">Payment methods</p>
            {hasAnyPaymentMethod(profile) ? (
              <div className="flex flex-wrap gap-1.5 mb-6">
                {getPayLinks(profile, amount, note).map((link) => (
                  <a key={link.key} href={link.url} target="_blank" rel="noopener noreferrer" className="pay-pill">
                    Pay via {link.label}
                  </a>
                ))}
                {profile.zelle_handle && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(profile.zelle_handle!)
                      setZelleCopied(true)
                    }}
                    className="pay-pill"
                  >
                    {zelleCopied ? 'Copied!' : 'Copy Zelle'}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                {displayName} hasn&apos;t added any payment methods yet.
              </p>
            )}
            <button type="button" onClick={onClose} className="btn-secondary w-full">
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}
