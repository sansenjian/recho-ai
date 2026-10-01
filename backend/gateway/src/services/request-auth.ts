import type { Request } from 'express'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { hashApiKey, lookupKeyUser, touchLastUsed } from './api-keys.js'
import { safeErrorDetail } from './safe-error.js'

export interface RequestUser {
  id: string
  email: string | null
  /** 本次请求是用哪把 API key 解析出来的(仅 rk- 路径)。 */
  keyId?: string
}

function bearerToken(req: Request) {
  const authorization = req.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1]?.trim() || null
}

export async function getRequestUser(req: Request): Promise<RequestUser | null> {
  const token = bearerToken(req)
  if (!token) return null

  // 外部客户端 API key(如 recho-cli 的 rk-*):查 api_keys 表解析所属用户
  if (token.startsWith('rk-')) {
    const user = await lookupKeyUser(hashApiKey(token))
    if (!user) {
      console.warn('[auth] ignoring invalid API key')
      return null
    }
    // 与 Go 网关保持同一语义:回写「最近使用」是旁路,不 await、失败只记日志。
    if (user.keyId) {
      void touchLastUsed(user.keyId).catch((err) => {
        console.warn('[auth] touch last_used_at failed:', safeErrorDetail(err))
      })
    }
    return user
  }

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
