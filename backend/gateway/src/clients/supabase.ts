import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_HTTP_PROXY,
  SUPABASE_URL,
} from '../config.js'

let publicClient: SupabaseClient | null = null
let adminClient: SupabaseClient | null = null

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
}

function createSupabaseDispatcher() {
  const proxy = SUPABASE_HTTP_PROXY.trim()
  if (!proxy) return null
  try {
    return new ProxyAgent(proxy)
  } catch {
    console.warn('[supabase] ignoring invalid SUPABASE_HTTP_PROXY configuration')
    return null
  }
}

const supabaseDispatcher = createSupabaseDispatcher()

const supabaseFetch: typeof fetch = ((input, init) => (
  undiciFetch(
    input as never,
    {
      ...(init ?? {}),
      ...(supabaseDispatcher ? { dispatcher: supabaseDispatcher } : {}),
    } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>
)) as typeof fetch

const supabaseGlobalOptions = supabaseDispatcher
  ? { fetch: supabaseFetch }
  : undefined

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
    ...(supabaseGlobalOptions ? { global: supabaseGlobalOptions } : {}),
  })
  return publicClient
}

export function getSupabaseAdminClient() {
  if (!hasSupabaseAdminConfig()) return null
  adminClient ??= createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: serverAuthOptions,
    ...(supabaseGlobalOptions ? { global: supabaseGlobalOptions } : {}),
  })
  return adminClient
}
