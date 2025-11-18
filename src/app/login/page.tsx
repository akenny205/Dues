'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import useAuth from '@/hooks/useAuth'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  // Check Supabase connection on mount
  useEffect(() => {
    console.log('Login page mounted')
    console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Set' : 'MISSING')
    console.log('Supabase Key:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set' : 'MISSING')
  }, [])

  // If already logged in, redirect to home
  useEffect(() => {
    if (!loading && user) {
      router.replace('/')
    }
  }, [loading, user, router])

  // Handle email verification from URL hash
  useEffect(() => {
    const handleEmailVerification = async () => {
      if (typeof window !== 'undefined' && window.location.hash) {
        // Wait for Supabase to process the hash
        await new Promise(resolve => setTimeout(resolve, 1000))
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          router.replace('/')
        }
      }
    }
    handleEmailVerification()
  }, [router])

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    console.log('=== FORM SUBMITTED ===')
    console.log('Form submitted!', { email, isSignUp, passwordLength: password.length })
    
    if (!email || !password) {
      console.log('Validation failed: missing email or password')
      setMessage('Please enter both email and password')
      return
    }

    console.log('Validation passed, starting auth...')
    setIsLoading(true)
    setMessage('')
    
    // Prevent any default form behavior
    if (e && e.preventDefault) {
      e.preventDefault()
    }

    try {
      if (isSignUp) {
        console.log('Attempting sign up...')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`
          }
        })

        console.log('Sign up response:', { data, error })

        if (error) {
          console.error('Sign up error:', error)
          // If user already exists, suggest signing in instead
          if (error.message?.includes('already registered') || error.message?.includes('User already registered')) {
            setMessage('This email is already registered. Please sign in instead.')
            setIsSignUp(false)
            throw error
          }
          throw error
        }
        
        setMessage('Check your email for the confirmation link!')
        setEmail('')
        setPassword('')
      } else {
        console.log('Attempting sign in...')
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        })

        console.log('Sign in response:', { data, error })
        console.log('Session data:', data?.session)
        console.log('User data:', data?.user)

        if (error) {
          console.error('Sign in error:', error)
          // Provide helpful error messages
          if (error.message?.includes('Invalid login credentials') || error.message?.includes('Invalid credentials')) {
            setMessage('Invalid email or password. Please try again.')
          } else if (error.message?.includes('Email not confirmed')) {
            setMessage('Please check your email and click the verification link to confirm your account.')
          } else {
            setMessage(error.message || 'Sign in failed. Please try again.')
          }
          setIsLoading(false)
          return
        }
        
        // Sign in successful - verify session and redirect
        if (data?.session) {
          console.log('Session exists, verifying...')
          // Double-check session is actually set
          const { data: { session: verifiedSession } } = await supabase.auth.getSession()
          console.log('Verified session:', verifiedSession)
          
          if (verifiedSession) {
            console.log('Session verified, redirecting to home...')
            // Use window.location.replace for immediate redirect
            // This ensures the page actually navigates
            window.location.replace('/')
          } else {
            console.error('Session not found after sign in')
            setMessage('Sign in successful but session not found. Please try again.')
            setIsLoading(false)
          }
        } else {
          console.error('No session in response')
          setMessage('Sign in successful but no session. Please try again.')
          setIsLoading(false)
        }
      }
    } catch (error: any) {
      console.error('Auth error:', error)
      // Don't override message if it was already set with a helpful message
      if (!message || message === '') {
        setMessage(error.message || 'An error occurred. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="border-2 border-gray-300 rounded-lg p-8 shadow-sm">
          <h1 className="text-2xl font-semibold mb-2 text-black">Dues</h1>
          <p className="text-sm text-gray-700 mb-6">
            {isSignUp ? 'Create an account' : 'Sign in to manage your groups and pay dues'}
          </p>

          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${
              message.includes('Check your email') 
                ? 'bg-green-50 border border-green-200 text-green-800' 
                : 'bg-yellow-50 border border-yellow-200 text-yellow-800'
            }`}>
              {message}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1 text-black">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1 text-black">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              onClick={() => {
                console.log('=== BUTTON CLICKED ===')
              }}
              className="w-full px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp)
                setMessage('')
              }}
              className="text-sm text-gray-700 hover:text-black font-medium"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
