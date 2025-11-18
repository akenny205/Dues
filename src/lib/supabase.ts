// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const getRedirectUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/`
  }
  return undefined
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
)
