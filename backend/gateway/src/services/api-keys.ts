import { createHash, randomBytes } from 'node:crypto'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { safeErrorDetail } from './safe-error.js'
import type { RequestUser } from './request-auth.js'

export interface ApiKeyRecord {
  id: string
  user_id: string
  name: string
  key_hash: string
  key_hint: string
  enabled: boolean
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface IssuedApiKey {
  plain: string
  hash: string
  hint: string
}

interface ApiKeyRow {
  id: string
  user_id: string
  name?: string | null
  key_hash: string
  key_hint?: string | null
  enabled?: boolean | null
  revoked_at?: string | null
  last_used_at?: string | null
  created_at?: string | null
}

const API_KEY_PREFIX = 'rk-'

/** plain = rk-<32B base64url>;仅返回明文一次,库中只存 hash。 */
export function generateApiKey(): IssuedApiKey {
  const plain = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return { plain, hash: hashApiKey(plain), hint: hintFromPlain(plain) }
}

export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex')
}

export function hintFromPlain(plain: string): string {
  if (plain.length <= 11) return plain
  return `${plain.slice(0, 7)}…${plain.slice(-4)}`
}

function normalizeRow(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: String(row.id || ''),
    user_id: String(row.user_id || ''),
    name: typeof row.name === 'string' ? row.name : '',
    key_hash: String(row.key_hash || ''),
    key_hint: typeof row.key_hint === 'string' ? row.key_hint : '',
    enabled: row.enabled !== false,
    revoked_at: typeof row.revoked_at === 'string' && row.revoked_at ? row.revoked_at : null,
    last_used_at: typeof row.last_used_at === 'string' && row.last_used_at ? row.last_used_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
  }
}

/** 按 key_hash 查有效 key,返回绑定用户;未命中/禁用/已撤销 → null。 */
export async function lookupKeyUser(keyHash: string): Promise<RequestUser | null> {
  const client = getSupabaseAdminClient()
  if (!client) return null
  try {
    const { data, error } = await client
      .from('api_keys')
      .select('user_id, enabled, revoked_at')
      .eq('key_hash', keyHash)
      .maybeSingle()
    if (error) {
      console.warn('[api-keys] lookup failed:', safeErrorDetail(error))
      return null
    }
    if (!data) return null
    if (data.enabled === false) return null
    if (data.revoked_at) return null
    return { id: String(data.user_id), email: null }
  } catch (err) {
    console.warn('[api-keys] lookup error:', safeErrorDetail(err))
    return null
  }
}

export async function createApiKey(userId: string, name: string): Promise<{ record: ApiKeyRecord; issued: IssuedApiKey }> {
  const client = getSupabaseAdminClient()
  if (!client) throw new Error('Supabase admin client is not configured')
  const issued = generateApiKey()
  const { data, error } = await client
    .from('api_keys')
    .insert({ user_id: userId, name: name.trim().slice(0, 100), key_hash: issued.hash, key_hint: issued.hint })
    .select()
    .single()
  if (error) throw error
  return { record: normalizeRow(data as ApiKeyRow), issued }
}

/** 列出 API key。传入 userId 时只返回该用户自己的 key（用户自助入口）。 */
export async function listApiKeys(userId?: string): Promise<ApiKeyRecord[]> {
  const client = getSupabaseAdminClient()
  if (!client) return []
  const base = client
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  const { data, error } = userId ? await base.eq('user_id', userId) : await base
  if (error) {
    console.warn('[api-keys] list failed:', safeErrorDetail(error))
    return []
  }
  return (data ?? []).map((row) => normalizeRow(row as ApiKeyRow))
}

/** 撤销(软删除):置 revoked_at。返回是否确有撤销。传入 userId 时只能撤销该用户自己的 key。 */
export async function revokeApiKey(id: string, userId?: string): Promise<boolean> {
  const client = getSupabaseAdminClient()
  if (!client) return false
  const base = client
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
  const { data, error } = await (userId ? base.eq('user_id', userId) : base).select('id').maybeSingle()
  if (error) {
    console.warn('[api-keys] revoke failed:', safeErrorDetail(error))
    return false
  }
  return Boolean(data)
}

/** 记录最近使用时间(尽力而为,失败不阻断请求)。 */
export async function touchLastUsed(id: string): Promise<void> {
  const client = getSupabaseAdminClient()
  if (!client) return
  await client.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', id)
}