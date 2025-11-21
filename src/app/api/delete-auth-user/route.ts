import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// This uses the service role key to delete auth users
// Only call this from the server side
export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      console.error('Delete auth user API: User ID is required')
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    // Check if service role key is configured
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      console.error('Delete auth user API: SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json({ 
        error: 'Service role key not configured. Please add SUPABASE_SERVICE_ROLE_KEY to your environment variables.' 
      }, { status: 500 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) {
      console.error('Delete auth user API: NEXT_PUBLIC_SUPABASE_URL is not configured')
      return NextResponse.json({ 
        error: 'Supabase URL not configured' 
      }, { status: 500 })
    }

    console.log('Delete auth user API: Attempting to delete user:', userId)

    // Use service role key for admin operations
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Delete the auth user
    const { data, error } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (error) {
      console.error('Error deleting auth user:', error)
      return NextResponse.json({ 
        error: error.message,
        code: error.status,
        details: error 
      }, { status: 500 })
    }

    console.log('Delete auth user API: Successfully deleted user:', userId)
    return NextResponse.json({ success: true, deletedUserId: userId })
  } catch (error: any) {
    console.error('Error in delete-auth-user API:', error)
    return NextResponse.json({ 
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 })
  }
}

