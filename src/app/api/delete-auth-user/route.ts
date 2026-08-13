import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// This uses the service role key to delete auth users — only ever called
// from login/page.tsx's signup-rollback path, to clean up the auth user
// Supabase just created when the follow-up User row insert fails.
//
// That's a *server* capability (admin.deleteUser needs the service role
// key), but this route itself is public, so it cannot just trust whatever
// userId it's handed — that would let anyone delete anyone else's account
// by passing in their id. The caller's own access token is required and
// verified against Supabase Auth to actually belong to that same user
// before anything is deleted.
export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const authHeader = request.headers.get('authorization') || ''
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
    if (!accessToken) {
      return NextResponse.json({ error: 'Missing access token' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !anonKey) {
      console.error('Delete auth user API: Supabase URL/anon key not configured')
      return NextResponse.json({ error: 'Server is not configured' }, { status: 500 })
    }
    if (!serviceRoleKey) {
      console.error('Delete auth user API: SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json({
        error: 'Service role key not configured. Please add SUPABASE_SERVICE_ROLE_KEY to your environment variables.',
      }, { status: 500 })
    }

    // Verify the token is real and actually belongs to the account being
    // deleted — this check is the only thing standing between this route
    // and "delete any account by guessing its id", so it isn't optional.
    const supabaseAsCaller = createClient(supabaseUrl, anonKey)
    const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser(accessToken)

    if (callerError || !callerData?.user) {
      console.error('Delete auth user API: invalid access token:', callerError)
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
    }
    if (callerData.user.id !== userId) {
      console.error('Delete auth user API: token/userId mismatch — refusing to delete another account')
      return NextResponse.json({ error: 'You can only delete your own account' }, { status: 403 })
    }

    // Use service role key for the actual admin operation
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (error) {
      console.error('Error deleting auth user:', error)
      return NextResponse.json({
        error: error.message,
        code: error.status,
      }, { status: 500 })
    }

    return NextResponse.json({ success: true, deletedUserId: userId })
  } catch (error: any) {
    console.error('Error in delete-auth-user API:', error)
    return NextResponse.json({
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }, { status: 500 })
  }
}
