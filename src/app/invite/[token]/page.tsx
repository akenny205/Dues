'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
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
      const { data, error: inviteError } = await supabase
        .from('Invite')
        .select('*, Group(*)')
        .eq('token', token)
        .single()

      if (inviteError) throw inviteError

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

      setInvite(data)
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

      // Check if user is already a member
      const { data: existingMember } = await supabase
        .from('GroupMember')
        .select('*')
        .eq('id', invite.group_id)
        .eq('user_id', dbUserId)
        .single()

      if (existingMember) {
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
      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">Loading...</div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">
            <h1 className="text-2xl font-semibold mb-4 text-black">Invite Error</h1>
            <p className="text-gray-700 mb-6">{error}</p>
            <Link href="/" className="text-black underline font-medium">
              Go to Home
            </Link>
          </div>
        </div>
      </main>
    )
  }

  if (success) {
    return (
      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">
            <h1 className="text-2xl font-semibold mb-4 text-black">Success!</h1>
            <p className="text-gray-700 mb-6">You've been added to the group. Redirecting...</p>
          </div>
        </div>
      </main>
    )
  }

  if (!invite) {
    return null
  }

  const group = invite.Group

  return (
    <main className="min-h-screen">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="max-w-md mx-auto border-2 border-gray-300 rounded-lg p-6">
          <h1 className="text-2xl font-semibold mb-4 text-black">Group Invitation</h1>
          <p className="text-gray-700 mb-4">
            You've been invited to join:
          </p>
          <div className="mb-6 p-4 bg-gray-50 rounded border-2 border-gray-300">
            <h2 className="text-xl font-semibold text-black mb-2">{group?.name || 'Untitled Group'}</h2>
            <p className="text-sm text-gray-600">Invited by: {invite.email}</p>
          </div>
          <button
            onClick={handleAcceptInvite}
            className="w-full px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
          >
            Accept Invitation
          </button>
          <Link href="/" className="block text-center mt-4 text-gray-700 hover:text-black">
            Cancel
          </Link>
        </div>
      </div>
    </main>
  )
}

