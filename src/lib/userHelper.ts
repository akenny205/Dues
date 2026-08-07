// Helper to bridge Supabase Auth (auth.users) with your User table
import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export async function getOrCreateUser(authUser: User): Promise<number | null> {
  try {
    if (!authUser || !authUser.email) {
      console.error('getOrCreateUser: No auth user or email provided')
      return null
    }

    // Prefer the stable auth link — this is what every RLS policy checks against.
    const { data: byAuthId } = await supabase
      .from('User')
      .select('id')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    if (byAuthId) {
      return byAuthId.id as number
    }

    // Fall back to email for rows created before the auth_user_id column existed
    // (or if the link is missing for any other reason), and heal them on the way.
    const { data: existingUser, error: findError } = await supabase
      .from('User')
      .select('id, auth_user_id')
      .eq('email', authUser.email)
      .maybeSingle()

    if (existingUser && !findError) {
      if (!existingUser.auth_user_id) {
        const { error: healError } = await supabase
          .from('User')
          .update({ auth_user_id: authUser.id })
          .eq('id', existingUser.id)

        if (healError) {
          console.error('getOrCreateUser: Failed to heal auth_user_id link:', healError)
        }
      }
      console.log('getOrCreateUser: Found existing user:', existingUser.id)
      return existingUser.id as number
    }

    // If there was an error other than "not found", log it
    if (findError && findError.code !== 'PGRST116') {
      console.error('getOrCreateUser: Error finding user:', findError)
    }

    // If not found, create a new user
    // Use email as username if username is required
    let username = authUser.email.split('@')[0] || `user_${Date.now()}`

    // Try to create user, if username conflict, append number
    let attempts = 0
    let newUser = null
    let createError = null

    while (attempts < 5) {
      const { data, error } = await supabase
        .from('User')
        .insert([{
          email: authUser.email,
          username: attempts > 0 ? `${username}_${attempts}` : username,
          auth_user_id: authUser.id
        }])
        .select('id')
        .single()

      if (!error) {
        newUser = data
        console.log('getOrCreateUser: Created new user:', newUser.id)
        break
      }

      // If it's a unique constraint error on username, try again with different username
      if (error.code === '23505' && error.message.includes('username')) {
        attempts++
        continue
      }

      // If it's a unique constraint error on email, user might have been created between check and insert
      if (error.code === '23505' && error.message.includes('email')) {
        console.log('getOrCreateUser: Email already exists, fetching user...')
        const { data: retryUser } = await supabase
          .from('User')
          .select('id, auth_user_id')
          .eq('email', authUser.email)
          .single()

        if (retryUser) {
          if (!retryUser.auth_user_id) {
            await supabase.from('User').update({ auth_user_id: authUser.id }).eq('id', retryUser.id)
          }
          return retryUser.id as number
        }
      }

      createError = error
      console.error('getOrCreateUser: Error creating user (attempt', attempts + 1, '):', error)
      break
    }

    if (createError || !newUser) {
      console.error('getOrCreateUser: Failed to create user after', attempts, 'attempts:', createError)
      return null
    }

    return newUser.id as number
  } catch (error) {
    console.error('getOrCreateUser: Unexpected error:', error)
    return null
  }
}
