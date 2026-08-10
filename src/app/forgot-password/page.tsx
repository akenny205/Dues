'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [message, setMessage] = useState<string>('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      setMessage('Please enter your email address')
      return
    }

    setIsLoading(true)
    setMessage('')

    // Always show the same success state regardless of whether the email
    // is registered, so this can't be used to enumerate accounts.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setIsLoading(false)
    setSubmitted(true)
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
          <h1 className="font-display text-2xl font-semibold mb-6">Forgot your password?</h1>

          {submitted ? (
            <div>
              <div className="mb-5 p-3 rounded-md text-sm font-medium border" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                If an account exists for {email.trim()}, we&apos;ve sent a link to reset your password. Check your inbox (and spam folder).
              </div>
              <div className="text-center">
                <Link href="/login" className="text-sm font-medium hover:underline" style={{ color: 'var(--text-muted)' }}>
                  Back to sign in
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
                Enter the email associated with your account and we&apos;ll send you a link to reset your password.
              </p>

              {message && (
                <div className="mb-5 p-3 rounded-md text-sm font-medium border" style={{ background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }}>
                  {message}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field"
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary w-full"
                >
                  {isLoading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <div className="mt-5 text-center">
                <Link href="/login" className="text-sm font-medium hover:underline" style={{ color: 'var(--text-muted)' }}>
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
