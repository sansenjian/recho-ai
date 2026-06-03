import type { Request } from 'express'
import { getSupabaseAdminClient } from '../clients/supabase.js'

function bearerToken(req: Request) {
  const authorization = req.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1]?.trim() || null
}

export async function getRequestUserId(req: Request) {
  const token = bearerToken(req)
  if (!token) return null

  const client = getSupabaseAdminClient()
  if (!client) return null

  const { data, error } = await client.auth.getUser(token)
  if (error) {
    console.warn('[auth] ignoring invalid Supabase access token:', error.message)
    return null
  }

  return data.user?.id || null
}
