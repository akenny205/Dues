'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import useAuth from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { getOrCreateUser } from '@/lib/userHelper'

interface Group {
  id: number
  Description: string | null
  created_at: string
}

interface Due {
  id: number
  session_id: number
  user_id: number
  amount: number
  Description: string | null
  paid: boolean
  created_at: string
  user_email?: string
}

export default function GroupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const groupId = parseInt(params.id as string)
  const { user, loading: authLoading } = useAuth()
  const [group, setGroup] = useState<Group | null>(null)
  const [dues, setDues] = useState<Due[]>([])
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [userId, setUserId] = useState<number | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
      return
    }

    if (user && groupId && !isNaN(groupId)) {
      // Get or create user in User table
      getOrCreateUser(user).then((dbUserId) => {
        if (dbUserId) {
          setUserId(dbUserId)
          loadGroup()
          loadDues()
        }
      })
    }
  }, [user, authLoading, router, groupId])

  const loadGroup = async () => {
    try {
      const { data, error } = await supabase
        .from('Session')
        .select('*')
        .eq('id', groupId)
        .single()

      if (error) throw error
      setGroup({
        id: data.id,
        Description: data.Description,
        created_at: data.created_at
      })
    } catch (error) {
      console.error('Error loading group:', error)
      router.push('/')
    }
  }

  const loadDues = async () => {
    try {
      const { data: duesData, error } = await supabase
        .from('SessionPayment')
        .select('*')
        .eq('session_id', groupId)
        .order('created_at', { ascending: false })

      if (error) throw error
      
      // Fetch user emails from User table
      const userIds = [...new Set((duesData || []).map((d: any) => d.user_id))]
      const emailMap: Record<number, string> = {}
      
      if (userIds.length > 0) {
        try {
          const { data: usersData } = await supabase
            .from('User')
            .select('id, email')
            .in('id', userIds)
          
          if (usersData) {
            usersData.forEach((user: any) => {
              emailMap[user.id] = user.email || 'Unknown'
            })
          }
        } catch (err) {
          console.log('Error fetching user emails:', err)
        }
      }
      
      // Combine dues with emails
      const transformedDues = (duesData || []).map((due: any) => ({
        id: due.id,
        session_id: due.session_id,
        user_id: due.user_id,
        amount: due.amount ? parseFloat(due.amount.toString()) * 100 : 0, // Convert to cents
        Description: due.Description,
        paid: false, // Your schema doesn't have a paid field, so we'll default to false
        created_at: due.created_at,
        user_email: emailMap[due.user_id] || 'Unknown'
      }))
      
      setDues(transformedDues)
    } catch (error) {
      console.error('Error loading dues:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddDue = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !amount || !userId) return

    const amountValue = parseFloat(amount)
    if (isNaN(amountValue) || amountValue <= 0) {
      alert('Please enter a valid amount')
      return
    }

    try {
      const { data, error } = await supabase
        .from('SessionPayment')
        .insert([{
          session_id: groupId,
          user_id: userId,
          amount: amountValue, // Store as numeric, not cents
          Description: description || null
        }])
        .select()
        .single()

      if (error) throw error
      
      if (data) {
        const newDue: Due = {
          id: data.id,
          session_id: data.session_id,
          user_id: data.user_id,
          amount: parseFloat(data.amount.toString()) * 100, // Convert to cents for display
          Description: data.Description,
          paid: false,
          created_at: data.created_at,
          user_email: user.email || 'Unknown'
        }
        setDues([newDue, ...dues])
        setAmount('')
        setDescription('')
      }
    } catch (error) {
      console.error('Error adding due:', error)
      alert('Failed to add due')
    }
  }

  const handlePayDue = async (dueId: number) => {
    // Note: Your schema doesn't have a 'paid' field
    // You might want to add this field to SessionPayment table
    // For now, we'll just remove it from the list or mark it locally
    try {
      // Since there's no paid field, we'll just remove it from the list
      // Or you could add a 'paid' boolean column to SessionPayment
      setDues(dues.filter(due => due.id !== dueId))
      alert('Due marked as paid (removed from list)')
    } catch (error) {
      console.error('Error paying due:', error)
      alert('Failed to mark due as paid')
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">Loading...</div>
        </div>
      </main>
    )
  }

  if (!group) {
    return null
  }

  const totalDue = dues.filter(d => !d.paid).reduce((sum, d) => sum + d.amount, 0)
  const userDues = dues.filter(d => d.user_id === user?.id)
  const userTotalDue = userDues.filter(d => !d.paid).reduce((sum, d) => sum + d.amount, 0)

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-gray-300">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-gray-700 hover:text-black font-medium">
            ← Back
          </Link>
          <h1 className="text-xl font-semibold text-black">{group.Description || 'Untitled Session'}</h1>
          <div></div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-black">Pay Dues</h2>
          
          <form onSubmit={handleAddDue} className="border-2 border-gray-300 rounded-lg p-4 mb-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1 text-black">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-black">Description (optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                  placeholder="e.g., Monthly dues"
                />
              </div>
            </div>
            <button
              type="submit"
              className="mt-4 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
            >
              Add Due
            </button>
          </form>
        </div>

        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4 text-black">Outstanding Dues</h3>
          {dues.length === 0 ? (
            <p className="text-gray-700">No dues yet.</p>
          ) : (
            <div className="space-y-2">
              {dues.map((due) => (
                <div
                  key={due.id}
                  className={`border-2 rounded-lg p-4 flex items-center justify-between ${
                    due.paid ? 'bg-gray-50 border-gray-300' : 'border-gray-300'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-black">
                        ${(due.amount / 100).toFixed(2)}
                      </span>
                      {due.paid && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                          Paid
                        </span>
                      )}
                    </div>
                    {due.Description && (
                      <p className="text-sm text-gray-700">{due.Description}</p>
                    )}
                    <p className="text-xs text-gray-600 mt-1">
                      {due.user_email} • {new Date(due.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {!due.paid && due.user_id === userId && (
                    <button
                      onClick={() => handlePayDue(due.id)}
                      className="ml-4 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition text-sm"
                    >
                      Mark as Paid
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-300 pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="border-2 border-gray-300 rounded-lg p-4">
              <p className="text-sm text-gray-700 mb-1 font-medium">Total Outstanding</p>
              <p className="text-2xl font-semibold text-black">${(totalDue / 100).toFixed(2)}</p>
            </div>
            <div className="border-2 border-gray-300 rounded-lg p-4">
              <p className="text-sm text-gray-700 mb-1 font-medium">Your Outstanding</p>
              <p className="text-2xl font-semibold text-black">${(userTotalDue / 100).toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

