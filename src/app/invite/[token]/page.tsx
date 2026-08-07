'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import useAuth from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { getOrCreateUser } from '@/lib/userHelper'

export default function InviteAcceptPage() {
  const router = useRouter()
  const params = useParams()
  const token = params.token as string
  const { user, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      // Redirect to login with return URL
      router.replace(`/login?redirect=/invite/${token}`)
      return
    }

    loadInvite()
  }, [user, authLoading, token, router])

  const loadInvite = async () => {
    try {
      // Invite is locked down to members-only in RLS, and we aren't a member of
      // its group yet — so this goes through a lookup function keyed on the
      // token itself (the invite link is the secret) rather than a plain select.
      const { data: rows, error: inviteError } = await supabase.rpc('find_invite_by_token', {
        input_token: token,
      })

      if (inviteError) throw inviteError

      const data = rows?.[0]

      if (!data) {
        setError('Invite not found')
        setLoading(false)
        return
      }

      // Check if invite is expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        setError('This invite has expired')
        setLoading(false)
        return
      }

      // Check if already accepted
      if (data.accepted_at) {
        setError('This invite has already been accepted')
        setLoading(false)
        return
      }

      setInvite({
        id: data.id,
        group_id: data.group_id,
        email: data.email,
        expires_at: data.expires_at,
        accepted_at: data.accepted_at,
        Group: { name: data.group_name },
      })
    } catch (error: any) {
      console.error('Error loading invite:', error)
      setError(error.message || 'Failed to load invite')
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptInvite = async () => {
    if (!user || !invite) return

    try {
      // Get or create user
      const dbUserId = await getOrCreateUser(user)
      if (!dbUserId) {
        setError('Failed to get user information')
        return
      }

      // Check if user email matches invite email
      if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
        setError(`This invite was sent to ${invite.email}, but you're signed in as ${user.email}. Please sign in with the correct account.`)
        return
      }

      // Check if user is already an active member (a removed member keeps their
      // row with status 'removed', so this has to check status specifically)
      const { data: existingMember } = await supabase
        .from('GroupMember')
        .select('status')
        .eq('id', invite.group_id)
        .eq('user_id', dbUserId)
        .single()

      if (existingMember && existingMember.status !== 'removed') {
        setError('You are already a member of this group')
        setLoading(false)
        router.push(`/groups/${invite.group_id}`)
        return
      }

      // Add user to group
      const { error: memberError } = await supabase
        .from('GroupMember')
        .insert([{
          id: invite.group_id,
          user_id: dbUserId,
          role: 'member'
        }])

      if (memberError) throw memberError

      // Mark invite as accepted
      const { error: updateError } = await supabase
        .from('Invite')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invite.id)

      if (updateError) {
        console.error('Error updating invite:', updateError)
        // Continue anyway - user was added to group
      }

      setSuccess(true)
      setTimeout(() => {
        router.push(`/groups/${invite.group_id}`)
      }, 2000)
    } catch (error: any) {
      console.error('Error accepting invite:', error)
      setError(error.message || 'Failed to accept invite')
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="eyebrow">Loading…</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="card max-w-md w-full text-center">
          <p className="eyebrow mb-2" style={{ color: 'var(--rust)' }}>Invite error</p>
          <p className="mb-6" style={{ color: 'var(--ink-muted)' }}>{error}</p>
          <Link href="/" className="text-sm font-semibold hover:underline inline-flex items-center gap-1.5" style={{ color: 'var(--ledger)' }}>
            Go to home <ArrowRight size={14} />
          </Link>
        </div>
      </main>
    )
  }

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="card max-w-md w-full text-center">
          <p className="eyebrow mb-2" style={{ color: 'var(--emerald)' }}>Success</p>
          <h1 className="font-display text-2xl font-semibold mb-2">You&apos;re in</h1>
          <p style={{ color: 'var(--ink-muted)' }}>You&apos;ve been added to the group. Redirecting…</p>
        </div>
      </main>
    )
  }

  if (!invite) {
    return null
  }

  const group = invite.Group

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="card max-w-md w-full">
        <p className="eyebrow mb-2">Group invitation</p>
        <h1 className="font-display text-2xl font-semibold mb-4">You&apos;ve been invited to join</h1>
        <div className="ledger-row mb-6" style={{ paddingTop: 0 }}>
          <div>
            <h2 className="font-semibold text-lg">{group?.name || 'Untitled Group'}</h2>
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Invited by {invite.email}</p>
          </div>
        </div>
        <button onClick={handleAcceptInvite} className="btn-primary w-full">
          Accept invitation
        </button>
        <Link href="/" className="block text-center mt-4 text-sm hover:underline" style={{ color: 'var(--ink-muted)' }}>
          Cancel
        </Link>
      </div>
    </main>
  )
}

