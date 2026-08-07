// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { mockSupabase } from './mockSupabaseClient'

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

const getRedirectUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/`
  }
  return undefined
}

// The app treats every query result loosely (`any`) throughout — same here.
// This project never generated Database types for the real client either,
// so this isn't a loss of type safety that previously existed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any

if (DEMO_MODE) {
  // Video/presentation mode — every supabase.from(...)/rpc(...)/auth call in
  // the app is served from in-memory seed data instead of the network.
  // No real project or credentials needed. See src/lib/mockData.ts to edit
  // the seeded people/groups/sessions, and README-DEMO.md for how to run it.
  client = mockSupabase
} else {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables. check .env.local file.')
  }

  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  })
}

export const supabase = client
