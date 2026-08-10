'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Camera } from 'lucide-react'
import Avatar from '@/components/Avatar'
import AuthPanel from '@/components/AuthPanel'
import Skeleton from '@/components/Skeleton'
import ToastStack from '@/components/ToastStack'
import useAuth from '@/hooks/useAuth'
import useToast from '@/hooks/useToast'
import { supabase } from '@/lib/supabase'
import { getOrCreateUser } from '@/lib/userHelper'
import { resizeImageToDataUrl } from '@/lib/avatar'

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

type UsernameStatus = 'unchanged' | 'invalid' | 'checking' | 'available' | 'taken' | 'unknown'

// Your own profile — photo, name, username, and payment methods, all
// editable. Anyone else's is the read-only quick-pay view in ProfileModal;
// this page is where self-editing actually lives now.
export default function ProfilePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { toasts, showToast, dismiss } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [userId, setUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)

  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('unchanged')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')

  const [venmo, setVenmo] = useState('')
  const [cashapp, setCashapp] = useState('')
  const [paypal, setPaypal] = useState('')
  const [zelle, setZelle] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState('')

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [authLoading, user, router])

  useEffect(() => {
    if (!user) return
    let mounted = true
    getOrCreateUser(user).then(async (id) => {
      if (!mounted) return
      if (!id) {
        setLoading(false)
        return
      }
      setUserId(id)
      const { data } = await supabase
        .from('User')
        .select('first_name, last_name, username, email, avatar_url, venmo_username, cashapp_cashtag, paypal_username, zelle_handle')
        .eq('id', id)
        .maybeSingle()
      if (!mounted) return
      setProfile(data)
      setFirstName(data?.first_name || '')
      setLastName(data?.last_name || '')
      setUsername(data?.username || '')
      setVenmo(data?.venmo_username || '')
      setCashapp(data?.cashapp_cashtag || '')
      setPaypal(data?.paypal_username || '')
      setZelle(data?.zelle_handle || '')
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [user])

  // Debounced availability check as you type a new username — mirrors the
  // check used at signup (src/app/login/page.tsx), but excludes your own row.
  useEffect(() => {
    if (!userId || !profile) return
    const trimmed = username.trim()

    if (trimmed === (profile.username || '')) {
      setUsernameStatus('unchanged')
      return
    }
    if (trimmed.length < 3) {
      setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('User')
        .select('id')
        .eq('username', trimmed)
        .neq('id', userId)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') {
        setUsernameStatus('unknown')
        return
      }
      setUsernameStatus(data ? 'taken' : 'available')
    }, 450)

    return () => clearTimeout(timer)
  }, [username, userId, profile])

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || 'Your profile'
    : '…'

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file || !userId) return

    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const dataUrl = await resizeImageToDataUrl(file)
      const { error } = await supabase.from('User').update({ avatar_url: dataUrl }).eq('id', userId)
      if (error) throw error
      setProfile((prev) => (prev ? { ...prev, avatar_url: dataUrl } : prev))
      showToast('Profile photo updated')
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to update photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleRemovePhoto = async () => {
    if (!userId) return
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const { error } = await supabase.from('User').update({ avatar_url: null }).eq('id', userId)
      if (error) throw error
      setProfile((prev) => (prev ? { ...prev, avatar_url: null } : prev))
      showToast('Profile photo removed')
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to remove photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId || !profile) return

    const trimmedUsername = username.trim()
    if (trimmedUsername.length < 3) {
      setProfileError('Username must be at least 3 characters')
      return
    }
    if (usernameStatus === 'taken') {
      setProfileError('That username is already taken')
      return
    }
    if (usernameStatus === 'checking') {
      setProfileError('Still checking that username — try again in a moment')
      return
    }

    setSavingProfile(true)
    setProfileError('')

    const patch = {
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      username: trimmedUsername,
    }
    const { error } = await supabase.from('User').update(patch).eq('id', userId)
    setSavingProfile(false)

    if (error) {
      // Belt-and-suspenders — User.username is UNIQUE at the DB level, so a
      // race against someone else claiming the name lands here even if our
      // own availability check said it was free a moment ago.
      if (error.code === '23505') {
        setProfileError('That username is already taken')
        setUsernameStatus('taken')
      } else {
        setProfileError('Failed to save. Please try again.')
      }
      return
    }

    setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
    setUsernameStatus('unchanged')
    showToast('Profile updated')
  }

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return

    setSavingPayment(true)
    setPaymentError('')

    const patch = {
      venmo_username: venmo.trim() || null,
      cashapp_cashtag: cashapp.trim() || null,
      paypal_username: paypal.trim() || null,
      zelle_handle: zelle.trim() || null,
    }
    const { error } = await supabase.from('User').update(patch).eq('id', userId)
    setSavingPayment(false)

    if (error) {
      console.error('Error saving payment methods:', error)
      setPaymentError('Failed to save. Please try again.')
      return
    }

    setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
    showToast('Payment methods saved')
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen">
        <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="w-9 h-9 rounded-full" />
          </div>
        </header>
        <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
          <div className="card flex flex-col items-center py-8">
            <Skeleton className="w-32 h-32 rounded-full mb-3" />
            <Skeleton className="h-5 w-32 mb-2" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="card space-y-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>
      </main>
    )
  }

  if (!profile || !userId) {
    return null
  }

  const usernameHint = (() => {
    switch (usernameStatus) {
      case 'checking':
        return { text: 'Checking availability…', color: 'var(--text-muted)' }
      case 'available':
        return { text: 'Username available', color: 'var(--accent)' }
      case 'taken':
        return { text: 'That username is already taken', color: 'var(--negative)' }
      case 'invalid':
        return { text: 'Must be at least 3 characters', color: 'var(--negative)' }
      case 'unknown':
        return { text: 'Could not check availability — try again', color: 'var(--negative)' }
      default:
        return null
    }
  })()

  const profileSaveDisabled =
    savingProfile || usernameStatus === 'checking' || usernameStatus === 'taken' || usernameStatus === 'invalid'

  return (
    <main className="min-h-screen">
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-sm font-medium hover:underline flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={16} /> Back
          </Link>
          <AuthPanel />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        {/* Photo */}
        <div className="card flex flex-col items-center text-center py-8">
          <div className="relative mb-3">
            <Avatar url={profile.avatar_url} name={displayName} size={128} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute bottom-0 right-0 rounded-full border p-2 disabled:opacity-50"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
              title="Change photo"
            >
              <Camera size={16} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoPick}
            className="hidden"
          />
          <h2 className="font-display text-xl font-semibold">{displayName}</h2>
          {profile.username && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>@{profile.username}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs">
            {uploadingPhoto && <span style={{ color: 'var(--text-muted)' }}>Saving photo…</span>}
            {!uploadingPhoto && profile.avatar_url && (
              <button type="button" onClick={handleRemovePhoto} className="hover:underline" style={{ color: 'var(--text-muted)' }}>
                Remove photo
              </button>
            )}
          </div>
          {photoError && (
            <p className="text-xs mt-1" style={{ color: 'var(--negative)' }}>{photoError}</p>
          )}
        </div>

        {/* Profile info */}
        <div className="card">
          <p className="eyebrow mb-4">Profile</p>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium mb-1">First name</label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="field"
                  placeholder="First"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium mb-1">Last name</label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="field"
                  placeholder="Last"
                />
              </div>
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-1">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                className="field"
                placeholder="yourname"
                minLength={3}
                required
              />
              {usernameHint && (
                <p className="text-xs mt-1" style={{ color: usernameHint.color }}>{usernameHint.text}</p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
              <input
                id="email"
                type="email"
                value={profile.email || ''}
                disabled
                className="field opacity-60"
                style={{ cursor: 'not-allowed' }}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Your email is tied to your login and can&apos;t be changed here.
              </p>
            </div>

            {profileError && (
              <div className="p-3 rounded-md text-sm border" style={{ background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }}>
                {profileError}
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={profileSaveDisabled}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>
          </form>
        </div>

        {/* Payment methods */}
        <div className="card">
          <p className="eyebrow mb-3">Payment methods</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Add the handles group-mates can use to pay you back. Dues just links out to these apps —
            it never touches your money.
          </p>
          <form onSubmit={handleSavePayment} className="space-y-4">
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

            {paymentError && (
              <div className="p-3 rounded-md text-sm border" style={{ background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }}>
                {paymentError}
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={savingPayment}>
              {savingPayment ? 'Saving…' : 'Save payment methods'}
            </button>
          </form>
        </div>

        {/* Room for what's next — notifications, theme, account controls.
            Kept as an honest placeholder rather than wiring up toggles that
            don't do anything yet. */}
        <div className="card">
          <p className="eyebrow mb-2">More settings</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Notification preferences, appearance, and account controls will live here as they ship.
          </p>
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </main>
  )
}
