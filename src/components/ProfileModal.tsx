'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { resizeImageToDataUrl } from '@/lib/avatar'
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
  // Called after any save (photo or settings) with a short message the
  // caller can toast; also a signal to refresh whatever list is showing
  // this person (their avatar/handles may have changed).
  onSaved?: (message: string) => void
  // Pre-fills the amount/note on this person's pay links — used when
  // opened from the "Make a payment" flow with an amount already typed in.
  amount?: number
  note?: string
}

// Shows one person's profile: photo, name, and payment info. When viewing
// your own (userId === currentUserId) the payment fields and photo are
// editable under a "Settings" heading; viewing anyone else shows the same
// info read-only, as quick-pay links.
export default function ProfileModal({ userId, currentUserId, onClose, onSaved, amount, note }: ProfileModalProps) {
  const isSelf = userId === currentUserId
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')

  const [venmo, setVenmo] = useState('')
  const [cashapp, setCashapp] = useState('')
  const [paypal, setPaypal] = useState('')
  const [zelle, setZelle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [zelleCopied, setZelleCopied] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase
      .from('User')
      .select('first_name, last_name, username, email, avatar_url, venmo_username, cashapp_cashtag, paypal_username, zelle_handle')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }: { data: ProfileRow | null }) => {
        if (!mounted) return
        setProfile(data)
        setVenmo(data?.venmo_username || '')
        setCashapp(data?.cashapp_cashtag || '')
        setPaypal(data?.paypal_username || '')
        setZelle(data?.zelle_handle || '')
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [userId])

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || 'Unknown'
    : '…'

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return

    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const dataUrl = await resizeImageToDataUrl(file)
      const { error } = await supabase.from('User').update({ avatar_url: dataUrl }).eq('id', userId)
      if (error) throw error
      setProfile((prev) => (prev ? { ...prev, avatar_url: dataUrl } : prev))
      onSaved?.('Profile photo updated')
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to update photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleRemovePhoto = async () => {
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const { error } = await supabase.from('User').update({ avatar_url: null }).eq('id', userId)
      if (error) throw error
      setProfile((prev) => (prev ? { ...prev, avatar_url: null } : prev))
      onSaved?.('Profile photo removed')
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to remove photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')

    const patch = {
      venmo_username: venmo.trim() || null,
      cashapp_cashtag: cashapp.trim() || null,
      paypal_username: paypal.trim() || null,
      zelle_handle: zelle.trim() || null,
    }
    const { error } = await supabase.from('User').update(patch).eq('id', userId)
    setSaving(false)

    if (error) {
      console.error('Error saving payment methods:', error)
      setSaveError('Failed to save. Please try again.')
      return
    }

    setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
    onSaved?.('Payment methods saved')
    onClose()
  }

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-w-md">
        {loading || !profile ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : (
          <>
            <div className="flex flex-col items-center text-center mb-6">
              <div className="relative mb-3">
                <Avatar url={profile.avatar_url} name={displayName} size={80} />
                {isSelf && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="absolute -bottom-1 -right-1 rounded-full border p-1.5 disabled:opacity-50"
                    style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                    title="Change photo"
                  >
                    <Camera size={14} />
                  </button>
                )}
              </div>
              {isSelf && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoPick}
                  className="hidden"
                />
              )}
              <h3 className="font-display text-xl font-semibold">{displayName}</h3>
              {profile.username && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>@{profile.username}</p>
              )}
              {isSelf && (
                <div className="mt-1 flex items-center gap-2 text-xs">
                  {uploadingPhoto && <span style={{ color: 'var(--text-muted)' }}>Saving photo…</span>}
                  {!uploadingPhoto && profile.avatar_url && (
                    <button type="button" onClick={handleRemovePhoto} className="hover:underline" style={{ color: 'var(--text-muted)' }}>
                      Remove photo
                    </button>
                  )}
                </div>
              )}
              {photoError && (
                <p className="text-xs mt-1" style={{ color: 'var(--negative)' }}>{photoError}</p>
              )}
            </div>

            {isSelf ? (
              <>
                <p className="eyebrow mb-3">Settings — payment methods</p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                  Add the handles group-mates can use to pay you back. Dues just links out to these apps —
                  it never touches your money.
                </p>
                <form onSubmit={handleSaveSettings} className="space-y-4">
                  <div>
                    <label htmlFor="venmoUsername" className="block text-sm font-medium mb-1">Venmo username</label>
                    <input
                      id="venmoUsername"
                      type="text"
                      value={venmo}
                      onChange={(e) => setVenmo(e.target.value)}
                      className="field"
                      placeholder="@yourname"
                    />
                  </div>
                  <div>
                    <label htmlFor="cashappCashtag" className="block text-sm font-medium mb-1">Cash App $cashtag</label>
                    <input
                      id="cashappCashtag"
                      type="text"
                      value={cashapp}
                      onChange={(e) => setCashapp(e.target.value)}
                      className="field"
                      placeholder="$yourname"
                    />
                  </div>
                  <div>
                    <label htmlFor="paypalUsername" className="block text-sm font-medium mb-1">PayPal.me username</label>
                    <input
                      id="paypalUsername"
                      type="text"
                      value={paypal}
                      onChange={(e) => setPaypal(e.target.value)}
                      className="field"
                      placeholder="yourname"
                    />
                  </div>
                  <div>
                    <label htmlFor="zelleHandle" className="block text-sm font-medium mb-1">Zelle (email or phone)</label>
                    <input
                      id="zelleHandle"
                      type="text"
                      value={zelle}
                      onChange={(e) => setZelle(e.target.value)}
                      className="field"
                      placeholder="you@example.com"
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Zelle doesn&apos;t support pay links — group-mates will copy this into their own banking app.
                    </p>
                  </div>

                  {saveError && (
                    <div className="p-3 rounded-md text-sm border" style={{ background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }}>
                      {saveError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary flex-1" disabled={saving}>
                      {saving ? 'Saving…' : 'Save settings'}
                    </button>
                    <button type="button" onClick={onClose} className="btn-secondary">
                      Close
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
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
          </>
        )}
      </div>
    </div>
  )
}
