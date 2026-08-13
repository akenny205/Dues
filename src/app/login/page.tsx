'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import useAuth from '@/hooks/useAuth'
import { Eye, EyeOff } from 'lucide-react'

// Rolls back the auth user Supabase just created when the follow-up User
// table insert fails, so a failed signup never leaves an orphaned auth
// account behind. The API route needs the caller's own access token to
// verify they're deleting their own (just-created) account rather than
// trusting the id alone — see src/app/api/delete-auth-user/route.ts.
async function deleteJustCreatedAuthUser(userId: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      console.error('Cannot delete auth user: no active session/access token')
      return false
    }

    const response = await fetch('/api/delete-auth-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId }),
    })

    const result = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('Failed to delete auth user:', result)
      return false
    }
    console.log('Auth user deleted successfully:', result)
    return true
  } catch (error) {
    console.error('Error calling delete-auth-user API:', error)
    return false
  }
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [signupFailed, setSignupFailed] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Check for signup query parameter
  useEffect(() => {
    const signupParam = searchParams.get('signup')
    if (signupParam === 'true') {
      setIsSignUp(true)
    }
  }, [searchParams])

  // Check Supabase connection on mount
  useEffect(() => {
    console.log('Login page mounted')
    console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Set' : 'MISSING')
    console.log('Supabase Key:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set' : 'MISSING')
  }, [])

  // If already logged in, redirect to home
  useEffect(() => {
    // Don't redirect if signup failed or if there's an error message
    // Also check session directly to ensure user is actually authenticated
    const checkRedirect = async () => {
      if (signupFailed || message) {
        console.log('Not redirecting: signupFailed or message present')
        return
      }
      
      if (!loading && user) {
        // Double-check session exists before redirecting
        const { data: { session } } = await supabase.auth.getSession()
        if (session && !signupFailed && !message) {
          console.log('Redirecting to home - user authenticated')
          router.replace('/')
        } else {
          console.log('Not redirecting: no session or signup failed')
        }
      }
    }
    
    checkRedirect()
  }, [loading, user, router, signupFailed, message])

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

  const checkUsernameAvailability = async (usernameToCheck: string): Promise<{ available: boolean; error?: string }> => {
    if (!usernameToCheck || usernameToCheck.trim().length === 0) {
      return { available: false, error: 'Username cannot be empty' }
    }

    try {
      const trimmedUsername = usernameToCheck.trim()
      console.log('Checking username availability for:', trimmedUsername)
      
      const { data, error } = await supabase
        .from('User')
        .select('id')
        .eq('username', trimmedUsername)
        .maybeSingle()

      console.log('Username check result:', { data, error, code: error?.code, message: error?.message, hint: error?.hint })

      // PGRST116 is "not found" which is fine - means username is available
      // But if we get any other error (like RLS policy violation), we should block signup
      if (error) {
        if (error.code === 'PGRST116') {
          // "Not found" - username is available
          console.log('Username not found - available')
          return { available: true }
        } else {
          // Any other error (RLS, permission, etc.) - block signup for safety
          console.error('Error checking username (blocking signup):', error)
          return { available: false, error: 'Unable to verify username availability. Please try again or contact support.' }
        }
      }

      // If we got here with no error, check if data exists
      // If data exists, username is taken
      const isAvailable = !data
      console.log('Username available?', isAvailable, 'Data:', data)
      if (data) {
        // Username exists
        return { available: false, error: 'This username is already taken. Please choose another one.' }
      }
      return { available: true }
    } catch (error: any) {
      console.error('Error checking username availability:', error)
      // If we can't check, default to blocking signup for safety
      return { available: false, error: 'Error checking username availability. Please try again.' }
    }
  }

  const checkEmailAvailability = async (emailToCheck: string): Promise<{ available: boolean; error?: string }> => {
    if (!emailToCheck || emailToCheck.trim().length === 0) {
      return { available: false, error: 'Email cannot be empty' }
    }

    try {
      const { data, error } = await supabase
        .from('User')
        .select('id')
        .eq('email', emailToCheck.trim().toLowerCase())
        .maybeSingle()

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking email:', error)
        return { available: false, error: 'Error checking email availability. Please try again.' }
      }

      // If data exists, email is taken
      return { available: !data }
    } catch (error) {
      console.error('Error checking email availability:', error)
      return { available: false, error: 'Error checking email availability. Please try again.' }
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (isLoading || checkingUsername) return

    console.log('=== FORM SUBMITTED ===')
    console.log('Form submitted!', { email, isSignUp, passwordLength: password.length, username })
    
    if (!email || !password) {
      console.log('Validation failed: missing email or password')
      setMessage('Please enter both email and password')
      return
    }

    if (isSignUp && !username) {
      setMessage('Please enter a username')
      return
    }

    if (isSignUp && username.trim().length < 3) {
      setMessage('Username must be at least 3 characters long')
      return
    }

    if (isSignUp && !firstName.trim()) {
      setMessage('Please enter your first name')
      return
    }

    if (isSignUp && !lastName.trim()) {
      setMessage('Please enter your last name')
      return
    }

    console.log('Validation passed, starting auth...')
    setIsLoading(true)
    setMessage('')
    setSignupFailed(false)
    
    // Prevent any default form behavior
    if (e && e.preventDefault) {
      e.preventDefault()
    }

    try {
      if (isSignUp) {
        // Check username and email availability
        setCheckingUsername(true)
        const [usernameCheck, emailCheck] = await Promise.all([
          checkUsernameAvailability(username.trim()),
          checkEmailAvailability(email.trim())
        ])
        setCheckingUsername(false)

        console.log('Username check result:', usernameCheck)
        if (!usernameCheck.available) {
          const errorMsg = usernameCheck.error || 'This username is already taken. Please choose another one.'
          console.log('Username not available - blocking signup:', errorMsg, usernameCheck)
          setIsLoading(false)
          setMessage(errorMsg)
          return
        }
        console.log('Username check passed, proceeding with signup')

        if (!emailCheck.available) {
          const errorMsg = emailCheck.error || 'This email is already registered. Please sign in instead.'
          console.log('Email not available:', errorMsg, emailCheck)
          setIsLoading(false)
          setMessage(errorMsg)
          setIsSignUp(false) // Switch to sign in mode
          return
        }

        // Double-check username and email availability right before signup
        // This is a final check to ensure both are still available
        console.log('Final check before signup...')
        setCheckingUsername(true)
        const [finalUsernameCheck, finalEmailCheck] = await Promise.all([
          checkUsernameAvailability(username.trim()),
          checkEmailAvailability(email.trim())
        ])
        setCheckingUsername(false)

        if (!finalUsernameCheck.available) {
          const errorMsg = finalUsernameCheck.error || 'This username is already taken. Please choose another one.'
          console.log('Final check: Username not available - blocking signup:', errorMsg)
          setIsLoading(false)
          setMessage(errorMsg)
          return
        }

        if (!finalEmailCheck.available) {
          const errorMsg = finalEmailCheck.error || 'This email is already registered. Please sign in instead.'
          console.log('Final check: Email not available - blocking signup:', errorMsg)
          setIsLoading(false)
          setMessage(errorMsg)
          setIsSignUp(false) // Switch to sign in mode
          return
        }

        // Validate that username and email are not empty before proceeding
        if (!username.trim() || !email.trim()) {
          setMessage('Username and email are required.')
          setIsLoading(false)
          return
        }

        console.log('Attempting sign up...')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              username: username.trim()
            }
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

        // Create user record with username immediately after signup
        // Only proceed if we have valid data
        if (data?.user && username.trim() && email.trim()) {
          // Set signupFailed flag early to prevent redirects
          // We'll clear it if the insert succeeds
          setSignupFailed(true)
          
          try {
            // Final validation before insert
            const trimmedUsername = username.trim()
            const trimmedEmail = email.trim()
            const trimmedFirstName = firstName.trim()
            const trimmedLastName = lastName.trim()

            if (!trimmedUsername || !trimmedEmail) {
              throw new Error('Username and email cannot be empty')
            }

            const { data: insertData, error: userError } = await supabase
              .from('User')
              .insert([{
                email: data.user.email || trimmedEmail,
                username: trimmedUsername,
                first_name: trimmedFirstName || null,
                last_name: trimmedLastName || null,
                auth_user_id: data.user.id
              }])
              .select()

            if (userError) {
              console.error('Error creating user record:', userError)
              console.log('Full error object:', JSON.stringify(userError, null, 2))
              console.log('Error details:', {
                code: userError.code,
                message: userError.message,
                details: userError.details,
                hint: userError.hint,
                status: (userError as any).status,
                statusCode: (userError as any).statusCode,
                statusText: (userError as any).statusText
              })
              
              // Handle unique constraint errors (username or email already exists)
              // Check for PostgreSQL unique constraint (23505) or HTTP 409 conflict
              const errorAny = userError as any
              const isConflict = userError.code === '23505' || 
                                userError.code === 'PGRST301' || // PostgREST conflict
                                errorAny.status === 409 ||
                                errorAny.statusCode === 409 ||
                                userError.message?.toLowerCase().includes('duplicate') ||
                                userError.message?.toLowerCase().includes('unique constraint') ||
                                userError.message?.toLowerCase().includes('already exists') ||
                                userError.details?.toLowerCase().includes('duplicate') ||
                                userError.details?.toLowerCase().includes('unique')
              
              // ALWAYS delete auth user if User table insert fails
              // This prevents orphaned auth users
              if (data?.user?.id) {
                await deleteJustCreatedAuthUser(data.user.id)
              } else {
                console.error('Cannot delete auth user: data.user.id is missing')
              }
              
              if (isConflict) {
                console.log('Conflict detected - username or email already exists')
                // signupFailed is already set above
                // Auth user deletion already handled above (happens before this check)
                
                // Sign out the user (auth user should already be deleted by API)
                await supabase.auth.signOut()
                // Wait a moment to ensure signout completes
                await new Promise(resolve => setTimeout(resolve, 300))
                
                const errorMsg = (userError.message || '').toLowerCase()
                const errorDetails = (userError.details || '').toLowerCase()
                const errorHint = (userError.hint || '').toLowerCase()
                
                // Check constraint name or error message for username
                if (errorMsg.includes('username') || 
                    errorDetails.includes('username') ||
                    errorHint.includes('username') ||
                    errorMsg.includes('user_username_key') ||
                    errorDetails.includes('user_username_key')) {
                  console.log('Username conflict detected')
                  setMessage('This username is already taken. Please choose another one.')
                } else if (errorMsg.includes('email') || 
                           errorDetails.includes('email') ||
                           errorHint.includes('email') ||
                           errorMsg.includes('user_email_key') ||
                           errorDetails.includes('user_email_key')) {
                  console.log('Email conflict detected')
                  setMessage('This email is already registered. Please sign in instead.')
                  setIsSignUp(false)
                } else {
                  // Default: assume username conflict (more common)
                  console.log('Generic conflict - assuming username')
                  setMessage('This username is already taken. Please choose another one.')
                }
                setIsLoading(false)
                return
              } else {
                console.log('Non-conflict error:', userError)
                // signupFailed is already set above
                // Auth user deletion already handled above (happens before this check)
                
                // Sign out the user (auth user should already be deleted by API)
                await supabase.auth.signOut()
                // Wait a moment to ensure signout completes
                await new Promise(resolve => setTimeout(resolve, 300))
                setMessage('Account created but failed to save user information. Please contact support.')
                setIsLoading(false)
                return
              }
            } else {
              // Insert succeeded - verify the data was actually inserted correctly
              if (insertData && insertData.length > 0) {
                const insertedUser = insertData[0]
                // Verify both username and email are present and not null
                if (!insertedUser.username || !insertedUser.email) {
                  console.error('User inserted but with missing username or email:', insertedUser)
                  // Delete the User record and auth user
                  if (insertedUser.id) {
                    try {
                      await supabase.from('User').delete().eq('id', insertedUser.id)
                      console.log('Deleted invalid User record')
                    } catch (deleteError) {
                      console.error('Error deleting invalid User record:', deleteError)
                    }
                  }
                  if (data?.user?.id) {
                    await deleteJustCreatedAuthUser(data.user.id)
                  }
                  setSignupFailed(true)
                  await supabase.auth.signOut()
                  setMessage('Error: User was created with invalid data. Please try again.')
                  setIsLoading(false)
                  return
                }
                // Success - both username and email are present
                console.log('User record created successfully with username and email')
              }
            }
          } catch (userError: any) {
            console.error('Error creating user record (catch block):', userError)
            console.log('Catch block error details:', JSON.stringify(userError, null, 2))
            // Handle errors that might not be caught by the if statement
            const isConflict = userError?.code === '23505' || 
                              userError?.code === 'PGRST301' ||
                              userError?.status === 409 ||
                              userError?.statusCode === 409 ||
                              userError?.message?.toLowerCase().includes('duplicate') ||
                              userError?.message?.toLowerCase().includes('unique') ||
                              userError?.message?.toLowerCase().includes('already exists')
            
            if (isConflict) {
              // signupFailed should already be set, but set it again to be safe
              setSignupFailed(true)
              
              // Delete the auth user since User table insert failed
              // We need to get the user ID from the data that was passed to this catch block
              // Since we're in a catch block, we might not have access to data?.user
              // Try to get it from the current session
              try {
                const { data: { session } } = await supabase.auth.getSession()
                if (session?.user?.id) {
                  await deleteJustCreatedAuthUser(session.user.id)
                }
              } catch (deleteError) {
                console.error('Error calling delete-auth-user API:', deleteError)
              }

              // Sign out the user
              await supabase.auth.signOut()
              // Wait a moment to ensure signout completes
              await new Promise(resolve => setTimeout(resolve, 300))
              setMessage('This username or email is already taken. Please choose different ones.')
              setIsLoading(false)
              return
            }
            // signupFailed should already be set, but set it again to be safe
            setSignupFailed(true)
            
            // Delete the auth user since User table insert failed
            try {
              const { data: { session } } = await supabase.auth.getSession()
              if (session?.user?.id) {
                await deleteJustCreatedAuthUser(session.user.id)
              }
            } catch (deleteError) {
              console.error('Error calling delete-auth-user API:', deleteError)
            }
            
            // Sign out the user
            await supabase.auth.signOut()
            // Wait a moment to ensure signout completes
            await new Promise(resolve => setTimeout(resolve, 300))
            setMessage('Account created but failed to save user information. Please contact support.')
            setIsLoading(false)
            return
          }
        }
        
        // If we got here, the User table insert succeeded
        // Clear the signupFailed flag so redirect can happen
        setSignupFailed(false)
        
        // Clear form and let the redirect happen (no message for now)
        setEmail('')
        setPassword('')
        setUsername('')
        setFirstName('')
        setLastName('')
        setMessage('')
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
      // Also check for username/email constraint errors from Supabase Auth
      if (!message || message === '') {
        if (error.message?.includes('already registered') || error.message?.includes('User already registered')) {
          setMessage('This email is already registered. Please sign in instead.')
          setIsSignUp(false)
        } else {
          setMessage(error.message || 'An error occurred. Please try again.')
        }
      }
    } finally {
      setIsLoading(false)
    }
  }

  const messageStyle = message.includes('Check your email')
    ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }
    : message.includes('already taken') || message.includes('already registered')
    ? { background: 'var(--negative-soft)', color: 'var(--negative)', borderColor: 'var(--negative)' }
    : { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="font-display text-3xl font-semibold tracking-tight">Dues</Link>
          <div className="mx-auto mt-3 h-px w-10" style={{ background: 'var(--accent)' }} />
        </div>

        <div className="card">
          <p className="eyebrow mb-1">{isSignUp ? 'Create account' : 'Welcome back'}</p>
          <h1 className="font-display text-2xl font-semibold mb-6">
            {isSignUp ? 'Get started' : 'Sign in to your groups'}
          </h1>

          {message && (
            <div className="mb-5 p-3 rounded-md text-sm font-medium border" style={messageStyle}>
              {message}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isSignUp && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium mb-1">First name</label>
                    <input
                      id="firstName"
                      name="firstName"
                      type="text"
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value)
                        setMessage('')
                      }}
                      className="field"
                      placeholder="John"
                      required
                      autoComplete="given-name"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium mb-1">Last name</label>
                    <input
                      id="lastName"
                      name="lastName"
                      type="text"
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value)
                        setMessage('')
                      }}
                      className="field"
                      placeholder="Doe"
                      required
                      autoComplete="family-name"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="username" className="block text-sm font-medium mb-1">Username</label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setMessage('') // Clear error message when user types
                    }}
                    className="field"
                    placeholder="johndoe"
                    required
                    minLength={3}
                    pattern="[a-zA-Z0-9_]+"
                    title="Username must be at least 3 characters and can only contain letters, numbers, and underscores"
                    autoComplete="username"
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>3+ characters, letters, numbers, and underscores only</p>
                </div>
              </>
            )}

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

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
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
                  autoComplete={isSignUp ? "new-password" : "current-password"}
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

            {!isSignUp && (
              <div className="text-right">
                <Link href="/forgot-password" className="text-sm font-medium hover:underline" style={{ color: 'var(--text-muted)' }}>
                  Forgot password?
                </Link>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || checkingUsername}
              className="btn-primary w-full"
            >
              {isLoading || checkingUsername ? 'Loading…' : isSignUp ? 'Sign up' : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp)
                setMessage('')
                setUsername('')
                setFirstName('')
                setLastName('')
              }}
              className="text-sm font-medium hover:underline"
              style={{ color: 'var(--text-muted)' }}
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="card text-center">
            <h1 className="font-display text-2xl font-semibold mb-2">Dues</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          </div>
        </div>
      </main>
    }>
      <LoginForm />
    </Suspense>
  )
}
