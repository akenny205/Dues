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

interface DeletedGroup {
  id: number
  name: string | null
  deleted_at: string
}

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
  preferred_payment_method: string | null
  auto_approve_sessions: string | null
}

type AutoApproveSessions = 'off' | 'live_only' | 'all'

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
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false)

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
  const [preferredMethod, setPreferredMethod] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState('')

  const [autoApprove, setAutoApprove] = useState<AutoApproveSessions>('off')
  const [savingApprovals, setSavingApprovals] = useState(false)

  const [deletedGroups, setDeletedGroups] = useState<DeletedGroup[]>([])
  const [restoringGroupId, setRestoringGroupId] = useState<number | null>(null)

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
        .select('first_name, last_name, username, email, avatar_url, venmo_username, cashapp_cashtag, paypal_username, zelle_handle, preferred_payment_method, auto_approve_sessions')
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
      setPreferredMethod(data?.preferred_payment_method || '')
      setAutoApprove((data?.auto_approve_sessions as AutoApproveSessions) || 'off')
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [user])

  // Groups you own that have been deleted (soft — see groups/[id]/page.tsx's
  // handleDeleteGroup) sit here so they're reachable for restoring. They
  // can't be reached from the group's own page anymore, since visiting a
  // deleted group's page just redirects you away.
  const loadDeletedGroups = async (ownerId: number) => {
    const { data, error } = await supabase
      .from('GroupMember')
      .select('id, role, Group(*)')
      .eq('user_id', ownerId)
      .eq('role', 'owner')

    if (error) {
      console.error('Error loading deleted groups:', error)
      return
    }

    const deleted = (data || [])
      .map((m: any) => m.Group)
      .filter((g: any) => g && g.deleted_at)
      .map((g: any) => ({ id: g.id, name: g.name, deleted_at: g.deleted_at }))

    setDeletedGroups(deleted)
  }

  useEffect(() => {
    if (userId) loadDeletedGroups(userId)
  }, [userId])

  const handleRestoreGroup = async (groupId: number) => {
    if (restoringGroupId !== null) return
    setRestoringGroupId(groupId)
    try {
      const { error } = await supabase.rpc('restore_group', { target_group_id: groupId })
      if (error) throw error
      setDeletedGroups((prev) => prev.filter((g) => g.id !== groupId))
      showToast('Group restored.')
    } catch (error: any) {
      console.error('Error restoring group:', error)
      showToast('Failed to restore group: ' + (error.message || 'Unknown error'))
    } finally {
      setRestoringGroupId(null)
    }
  }

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
    if (!file || !userId || uploadingPhoto) return

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
    if (!userId || uploadingPhoto) return
    setConfirmRemovePhoto(false)
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
    if (!userId || !profile || savingProfile) return

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
      setProfileError('Still checking that username. try again in a moment')
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
    if (!userId || savingPayment) return

    setSavingPayment(true)
    setPaymentError('')

    const handlesByMethod: Record<string, string> = { venmo, cashapp, paypal, zelle }
    const patch = {
      venmo_username: venmo.trim() || null,
      cashapp_cashtag: cashapp.trim() || null,
      paypal_username: paypal.trim() || null,
      zelle_handle: zelle.trim() || null,
      // Can't stay "preferred" if its own handle just got cleared out.
      preferred_payment_method: preferredMethod && handlesByMethod[preferredMethod].trim() ? preferredMethod : null,
    }
    const { error } = await supabase.from('User').update(patch).eq('id', userId)
    setSavingPayment(false)

    if (error) {
      console.error('Error saving payment methods:', error)
      setPaymentError('Failed to save. Please try again.')
      return
    }

    setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
    setPreferredMethod(patch.preferred_payment_method || '')
    showToast('Payment methods saved')
  }

  const handleSaveApprovals = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId || savingApprovals) return

    setSavingApprovals(true)
    const patch = { auto_approve_sessions: autoApprove }
    const { error } = await supabase.from('User').update(patch).eq('id', userId)
    setSavingApprovals(false)

    if (error) {
      console.error('Error saving approval preference:', error)
      showToast('Failed to save. Please try again.')
      return
    }

    setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
    showToast('Approval preference saved')
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
        return { text: 'Could not check availability. try again', color: 'var(--negative)' }
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
              <button type="button" onClick={() => setConfirmRemovePhoto(true)} className="hover:underline" style={{ color: 'var(--text-muted)' }}>
                Remove photo
              </button>
            )}
          </div>
          {photoError && (
            <p className="text-xs mt-1" style={{ color: 'var(--negative)' }}>{photoError}</p>
          )}
        </div>

        {confirmRemovePhoto && (
          <div className="modal-overlay">
            <div className="modal-panel">
              <h3 className="font-display text-xl font-semibold mb-2">Remove profile photo?</h3>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                You&apos;ll go back to a plain initial until you upload a new one.
              </p>
              <div className="flex gap-2">
                <button onClick={handleRemovePhoto} className="btn-danger flex-1" disabled={uploadingPhoto}>
                  {uploadingPhoto ? 'Removing…' : 'Remove photo'}
                </button>
                <button onClick={() => setConfirmRemovePhoto(false)} className="btn-secondary" disabled={uploadingPhoto}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

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
            Add the handles group-mates can use to pay you back. Dues just links out to these apps.
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
                Zelle doesn&apos;t support pay links. Group-mates must copy this into their own banking app.
              </p>
            </div>

            <div>
              <label htmlFor="preferredMethod" className="block text-sm font-medium mb-1">Preferred method</label>
              <select
                id="preferredMethod"
                value={preferredMethod}
                onChange={(e) => setPreferredMethod(e.target.value)}
                className="field"
              >
                <option value="">No preference</option>
                {venmo.trim() && <option value="venmo">Venmo</option>}
                {cashapp.trim() && <option value="cashapp">Cash App</option>}
                {paypal.trim() && <option value="paypal">PayPal</option>}
                {zelle.trim() && <option value="zelle">Zelle</option>}
              </select>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Shown first to group-mates paying you back. Only methods with a handle above are selectable.
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

        {/* Deleted groups you own — a deleted group bounces anyone away the
            moment its own page loads, so this is the only place left to
            bring one back. */}
        {deletedGroups.length > 0 && (
          <div className="card">
            <p className="eyebrow mb-1">Archived Groups</p>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Groups you deleted stay here so you can bring them back. Nothing was lost — members, sessions, and payment history are all still there.
            </p>
            <div className="space-y-3">
              {deletedGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">{g.name || 'Untitled Group'}</p>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Deleted {new Date(g.deleted_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestoreGroup(g.id)}
                    className="btn-secondary text-sm shrink-0"
                    disabled={restoringGroupId === g.id}
                  >
                    {restoringGroupId === g.id ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Approvals */}
        <div className="card">
          <p className="eyebrow mb-3">Approvals</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            By default, anything that changes your balance — a new session, an edit,
            a payment, a settle up — waits for you to approve it. Auto-approve skips
            that click for the cases you pick below.
          </p>
          <form onSubmit={handleSaveApprovals} className="space-y-3">
            {(
              [
                { value: 'off', label: 'Off', description: "Approve everything yourself — the default." },
                { value: 'live_only', label: 'Live sessions only', description: "Skip approving a live session's final total when it closes. Its total already had to sum to $0.00 before anyone could even propose closing, so there's little left to review. Everything else still waits for you." },
                { value: 'all', label: 'All sessions', description: 'Skip approving anything that lands on you — new sessions, edits, payments, settle ups, and deletions included. Only turn this on for groups you fully trust.' },
              ] as { value: AutoApproveSessions; label: string; description: string }[]
            ).map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer"
                style={{ borderColor: autoApprove === option.value ? 'var(--accent)' : 'var(--border)' }}
              >
                <input
                  type="radio"
                  name="autoApprove"
                  value={option.value}
                  checked={autoApprove === option.value}
                  onChange={() => setAutoApprove(option.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{option.description}</span>
                </span>
              </label>
            ))}

            <button type="submit" className="btn-primary" disabled={savingApprovals}>
              {savingApprovals ? 'Saving…' : 'Save approval preference'}
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
