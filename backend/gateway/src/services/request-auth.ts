import type { Request } from 'express'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { safeErrorDetail } from './safe-error.js'

export interface RequestUser {
  id: string
  email: string | null
}

function bearerToken(req: Request) {
  const authorization = req.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1]?.trim() || null
}

export async function getRequestUser(req: Request): Promise<RequestUser | null> {
  const token = bearerToken(req)
  if (!token) return null

  const client = getSupabaseAdminClient()
  if (!client) return null

  const { data, error } = await client.auth.getUser(token)
  if (error) {
    console.warn('[auth] ignoring invalid Supabase access token:', safeErrorDetail(error))
    return null
  }

  const user = data.user
  if (!user?.id) return null
  return {
    id: user.id,
    email: user.email || null,
  }
}

export async function getRequestUserId(req: Request) {
  const user = await getRequestUser(req)
  return user?.id || null
}
