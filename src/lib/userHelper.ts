// Helper to bridge Supabase Auth (auth.users) with your User table
import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export async function getOrCreateUser(authUser: User): Promise<number | null> {
  try {
    // First, try to find existing user by email
    const { data: existingUser, error: findError } = await supabase
      .from('User')
      .select('id')
      .eq('email', authUser.email || '')
      .single()

    if (existingUser && !findError) {
      return existingUser.id as number
    }

    // If not found, create a new user
    // Use email as username if username is required
    let username = authUser.email?.split('@')[0] || `user_${Date.now()}`
    
    // Try to create user, if username conflict, append number
    let attempts = 0
    let newUser = null
    let createError = null
    
    while (attempts < 5) {
      const { data, error } = await supabase
        .from('User')
        .insert([{
          email: authUser.email || '',
          username: attempts > 0 ? `${username}_${attempts}` : username
        }])
        .select('id')
        .single()

      if (!error) {
        newUser = data
        break
      }
      
      // If it's a unique constraint error on username, try again with different username
      if (error.code === '23505' && error.message.includes('username')) {
        attempts++
        continue
      }
      
      createError = error
      break
    }

    if (createError || !newUser) {
      console.error('Error creating user:', createError)
      return null
    }

    return newUser.id as number
  } catch (error) {
    console.error('Error in getOrCreateUser:', error)
    return null
  }
}

