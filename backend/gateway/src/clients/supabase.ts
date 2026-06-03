import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from '../config.js'

let publicClient: SupabaseClient | null = null
let adminClient: SupabaseClient | null = null

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
}

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)
}

export function hasSupabaseAdminConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
}

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) return null
  publicClient ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: serverAuthOptions,
  })
  return publicClient
}

export function getSupabaseAdminClient() {
  if (!hasSupabaseAdminConfig()) return null
  adminClient ??= createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: serverAuthOptions,
  })
  return adminClient
}
