import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { apiUrl } from './api-base'

interface SupabasePublicConfig {
  configured: boolean
  url: string | null
  publishableKey: string | null
}

let client: SupabaseClient | null = null
let clientPromise: Promise<SupabaseClient> | null = null

function createBrowserClient(url: string, publishableKey: string) {
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      persistSession: true,
    },
  })
}

function envConfig(): SupabasePublicConfig {
  const url = import.meta.env.VITE_SUPABASE_URL || null
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    null

  return {
    configured: Boolean(url && publishableKey),
    url,
    publishableKey,
  }
}

async function fetchGatewayConfig(): Promise<SupabasePublicConfig> {
  const response = await fetch(apiUrl('/api/config/supabase'))
  if (!response.ok) {
    throw new Error('无法读取 Supabase 配置')
  }
  return await response.json() as SupabasePublicConfig
}

function clientFromConfig(config: SupabasePublicConfig) {
  if (!config.configured || !config.url || !config.publishableKey) {
    throw new Error('Supabase 尚未配置')
  }
  return createBrowserClient(config.url, config.publishableKey)
}

export async function getSupabaseClient() {
  if (client) return client

  const localConfig = envConfig()
  if (localConfig.configured) {
    client = clientFromConfig(localConfig)
    return client
  }

  clientPromise ??= fetchGatewayConfig().then((config) => {
    client = clientFromConfig(config)
    return client
  })

  return await clientPromise
}

export function resetSupabaseClientForTests() {
  client = null
  clientPromise = null
}
