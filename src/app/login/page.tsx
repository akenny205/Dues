'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import useAuth from '@/hooks/useAuth'

export default function LoginPage() {
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
                last_name: trimmedLastName || null
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
                console.log('Attempting to delete auth user:', data.user.id)
                try {
                  const deleteResponse = await fetch('/api/delete-auth-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: data.user.id })
                  })
                  
                  const deleteResult = await deleteResponse.json()
                  
                  if (!deleteResponse.ok) {
                    console.error('Failed to delete auth user:', deleteResult)
                    // Try to get more details about the error
                    const errorText = await deleteResponse.text()
                    console.error('Delete API error response:', errorText)
                  } else {
                    console.log('Auth user deleted successfully:', deleteResult)
                  }
                } catch (deleteError) {
                  console.error('Error calling delete-auth-user API:', deleteError)
                  // Log the full error for debugging
                  if (deleteError instanceof Error) {
                    console.error('Delete error details:', deleteError.message, deleteError.stack)
                  }
                }
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
                    try {
                      await fetch('/api/delete-auth-user', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: data.user.id })
                      })
                      console.log('Deleted auth user after invalid User record')
                    } catch (deleteError) {
                      console.error('Error deleting auth user:', deleteError)
                    }
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
                  const deleteResponse = await fetch('/api/delete-auth-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: session.user.id })
                  })
                  
                  if (!deleteResponse.ok) {
                    console.error('Failed to delete auth user, but continuing...')
                  } else {
                    console.log('Auth user deleted successfully')
                  }
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
                const deleteResponse = await fetch('/api/delete-auth-user', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: session.user.id })
                })
                
                if (!deleteResponse.ok) {
                  console.error('Failed to delete auth user, but continuing...')
                } else {
                  console.log('Auth user deleted successfully')
                }
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

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="border-2 border-gray-300 rounded-lg p-8 shadow-sm">
          <h1 className="text-2xl font-semibold mb-2 text-black">Dues</h1>
          <p className="text-sm text-gray-700 mb-6">
            {isSignUp ? 'Create an account' : 'Sign in to manage your groups and pay dues'}
          </p>

          {message && (
            <div className={`mb-4 p-3 rounded text-sm font-medium ${
              message.includes('Check your email') 
                ? 'bg-green-50 border border-green-200 text-green-800' 
                : message.includes('already taken') || message.includes('already registered')
                ? 'bg-red-50 border border-red-200 text-red-800'
                : 'bg-yellow-50 border border-yellow-200 text-yellow-800'
            }`}>
              {message}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isSignUp && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium mb-1 text-black">First Name</label>
                    <input
                      id="firstName"
                      name="firstName"
                      type="text"
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value)
                        setMessage('')
                      }}
                      className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                      placeholder="John"
                      required
                      autoComplete="given-name"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium mb-1 text-black">Last Name</label>
                    <input
                      id="lastName"
                      name="lastName"
                      type="text"
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value)
                        setMessage('')
                      }}
                      className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                      placeholder="Doe"
                      required
                      autoComplete="family-name"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="username" className="block text-sm font-medium mb-1 text-black">Username</label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setMessage('') // Clear error message when user types
                    }}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:border-black focus:outline-none"
                    placeholder="johndoe"
                    required
                    minLength={3}
                    pattern="[a-zA-Z0-9_]+"
                    title="Username must be at least 3 characters and can only contain letters, numbers, and underscores"
                    autoComplete="username"
                  />
                  <p className="text-xs text-gray-600 mt-1">3+ characters, letters, numbers, and underscores only</p>
                </div>
              </>
            )}

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
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || checkingUsername}
              onClick={() => {
                console.log('=== BUTTON CLICKED ===')
              }}
              className="w-full px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading || checkingUsername ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp)
                setMessage('')
                setUsername('')
                setFirstName('')
                setLastName('')
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
