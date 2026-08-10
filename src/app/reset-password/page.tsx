'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { AuthChangeEvent } from '@supabase/supabase-js'
import { Eye, EyeOff } from 'lucide-react'

type Status = 'checking' | 'ready' | 'invalid'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  // The reset link Supabase emails lands here with a recovery token in the
  // URL hash. supabase-js picks it up automatically (detectSessionInUrl)
  // and fires a PASSWORD_RECOVERY auth event once the session is set.
  useEffect(() => {
    let mounted = true
    const resolved = { current: false }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY') {
        resolved.current = true
        setStatus('ready')
      }
    })

    // In case the event already fired before this listener attached,
    // fall back to checking whether a session already exists.
    const fallbackCheck = setTimeout(async () => {
      if (resolved.current) return
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted || resolved.current) return
      setStatus(session ? 'ready' : 'invalid')
    }, 2000)

    return () => {
      mounted = false
      clearTimeout(fallbackCheck)
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password.length < 6) {
      setMessage('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setMessage('Passwords do not match')
      return
    }

    setIsLoading(true)
    setMessage('')

    const { error } = await supabase.auth.updateUser({ password })

    setIsLoading(false)

    if (error) {
      setMessage(error.message || 'Could not update password. Please try again.')
      return
    }

    setSuccess(true)
    setTimeout(() => router.replace('/'), 2000)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="font-display text-3xl font-semibold tracking-tight">Dues</Link>
          <div className="mx-auto mt-3 h-px w-10" style={{ background: 'var(--accent)' }} />
        </div>

        <div className="card">
          <p className="eyebrow mb-1">Reset password</p>
          <h1 className="font-display text-2xl font-semibold mb-6">Choose a new password</h1>

          {status === 'checking' && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Verifying your reset link…</p>
          )}

          {status === 'invalid' && (
            <div>
              <div className="mb-5 p-3 rounded-md text-sm font-medium border" style={{ background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }}>
                This reset link is invalid or has expired. Please request a new one.
              </div>
              <Link href="/forgot-password" className="btn-primary w-full inline-block text-center">
                Request a new link
              </Link>
            </div>
          )}

          {status === 'ready' && !success && (
            <>
              {message && (
                <div className="mb-5 p-3 rounded-md text-sm font-medium border" style={{ background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }}>
                  {message}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-1">New password</label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="field pr-10"
                      placeholder="••••••••"
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="field-icon-btn"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1">Confirm new password</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="field"
                    placeholder="••••••••"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary w-full"
                >
                  {isLoading ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}

          {success && (
            <div className="p-3 rounded-md text-sm font-medium border" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }}>
              Your password has been updated. Redirecting you in…
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
