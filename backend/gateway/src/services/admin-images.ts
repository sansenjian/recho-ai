import type { User } from '@supabase/supabase-js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { imagePublicUrl } from './image-storage.js'
import { redactSensitiveText } from './safe-error.js'

const IMAGE_HISTORY_TABLE = 'image_generations'
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 60
const ADMIN_IMAGE_COLUMNS = [
  'id',
  'user_id',
  'preview_url',
  'preview_path',
  'thumbnail_url',
  'thumbnail_path',
  'visibility',
  'funding_source',
  'credit_cost',
  'prompt',
  'user_prompt',
  'size',
  'aspect_ratio',
  'resolution',
  'quality',
  'generated_at',
].join(',')

export type AdminImageVisibility = 'public' | 'private'
export type AdminImageFundingSource = 'free' | 'credit'

export interface AdminImageItem {
  id: string
  userId: string | null
  email: string | null
  prompt: string
  previewUrl: string | null
  thumbnailUrl: string | null
  visibility: AdminImageVisibility
  fundingSource: string | null
  creditCost: number
  size: string | null
  aspectRatio: string | null
  resolution: string | null
  quality: string | null
  generatedAt: string | null
}

export class AdminImageError extends Error {
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.status = options.status ?? statusForAdminImageError(code)
    this.publicMessage = options.publicMessage ?? publicMessageForAdminImageError(code)
  }
}

function statusForAdminImageError(code: string) {
  if (code === 'image_not_found') return 404
  if (code === 'image_service_unavailable') return 503
  return 400
}

function publicMessageForAdminImageError(code: string) {
  if (code === 'invalid_image_id') return '图片 ID 无效。'
  if (code === 'invalid_visibility') return '图片可见性无效。'
  if (code === 'credit_image_must_stay_private') return '额度生成的图片不能公开到作品广场。'
  if (code === 'image_not_found') return '图片不存在。'
  if (code === 'image_service_unavailable') return '图片后台服务暂时不可用。'
  return '图片后台操作失败，请稍后重试。'
}

function requireAdminImageClient() {
  const client = getSupabaseAdminClient()
  if (!client) throw new AdminImageError('image_service_unavailable')
  return client
}

function sanitizedLimit(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(number)))
}

function sanitizedVisibility(value: unknown): AdminImageVisibility | null {
  return value === 'public' || value === 'private' ? value : null
}

function sanitizedFundingSource(value: unknown): AdminImageFundingSource | null {
  return value === 'free' || value === 'credit' ? value : null
}

function sanitizedFilterText(value: unknown, maxLength = 80) {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/[%,()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  return text || null
}

function safeText(value: unknown, maxLength = 180) {
  if (typeof value !== 'string') return ''
  return redactSensitiveText(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' && value ? value : null
}

function publicUrlField(row: Record<string, unknown>, key: string) {
  const value = stringField(row, key)
  return value && /^https?:\/\//i.test(value) ? value : null
}

function normalizedInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function toUserSummary(user: User) {
  return {
    id: user.id,
    email: user.email || null,
  }
}

export function toAdminImageItem(
  row: Record<string, unknown>,
  user?: ReturnType<typeof toUserSummary>,
): AdminImageItem {
  const previewPath = stringField(row, 'preview_path')
  const thumbnailPath = stringField(row, 'thumbnail_path')
  const prompt = safeText(row.user_prompt || row.prompt || '')
  const visibility = sanitizedVisibility(row.visibility) || 'public'

  return {
    id: String(row.id || ''),
    userId: stringField(row, 'user_id'),
    email: user?.email || null,
    prompt,
    previewUrl: imagePublicUrl(previewPath) || publicUrlField(row, 'preview_url') || null,
    thumbnailUrl: imagePublicUrl(thumbnailPath) || publicUrlField(row, 'thumbnail_url') || null,
    visibility,
    fundingSource: stringField(row, 'funding_source'),
    creditCost: normalizedInteger(row.credit_cost),
    size: stringField(row, 'size'),
    aspectRatio: stringField(row, 'aspect_ratio'),
    resolution: stringField(row, 'resolution'),
    quality: stringField(row, 'quality'),
    generatedAt: stringField(row, 'generated_at'),
  }
}

async function usersById(userIds: string[]) {
  const client = requireAdminImageClient()
  const users = new Map<string, ReturnType<typeof toUserSummary>>()

  await Promise.all(userIds.map(async userId => {
    const { data, error } = await client.auth.admin.getUserById(userId)
    if (!error && data.user) {
      users.set(userId, toUserSummary(data.user))
    }
  }))

  return users
}

export async function listAdminImages(options: {
  limit?: unknown
  visibility?: unknown
  fundingSource?: unknown
  userId?: unknown
  query?: unknown
} = {}) {
  const client = requireAdminImageClient()
  const limit = sanitizedLimit(options.limit)
  const visibility = sanitizedVisibility(options.visibility)
  const fundingSource = sanitizedFundingSource(options.fundingSource)
  const userId = sanitizedFilterText(options.userId, 80)
  const queryText = sanitizedFilterText(options.query, 80)

  let query = client
    .from(IMAGE_HISTORY_TABLE)
    .select(ADMIN_IMAGE_COLUMNS)

  if (visibility) query = query.eq('visibility', visibility)
  if (fundingSource) query = query.eq('funding_source', fundingSource)
  if (userId) query = query.eq('user_id', userId)
  if (queryText) {
    query = query.or(`user_prompt.ilike.%${queryText}%,prompt.ilike.%${queryText}%`)
  }

  const { data, error } = await query
    .order('generated_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  const rows = (data || []) as unknown as Array<Record<string, unknown>>
  const userIds = Array.from(new Set(
    rows
      .map(row => stringField(row, 'user_id'))
      .filter((userId): userId is string => Boolean(userId)),
  ))
  const users = await usersById(userIds)

  return rows.map(row => toAdminImageItem(row, users.get(String(row.user_id || ''))))
}

export async function setAdminImageVisibility(id: string, visibilityValue: unknown) {
  if (!id || id.length > 160) throw new AdminImageError('invalid_image_id')
  const visibility = sanitizedVisibility(visibilityValue)
  if (!visibility) throw new AdminImageError('invalid_visibility')

  const client = requireAdminImageClient()
  const { data: existing, error: lookupError } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select(ADMIN_IMAGE_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (lookupError) throw lookupError
  if (!existing) throw new AdminImageError('image_not_found')
  const existingRow = existing as unknown as Record<string, unknown>
  if (visibility === 'public' && stringField(existingRow, 'funding_source') === 'credit') {
    throw new AdminImageError('credit_image_must_stay_private')
  }

  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .update({ visibility })
    .eq('id', id)
    .select(ADMIN_IMAGE_COLUMNS)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new AdminImageError('image_not_found')

  const updatedRow = data as unknown as Record<string, unknown>
  const userId = stringField(updatedRow, 'user_id')
  const users = userId ? await usersById([userId]) : new Map<string, ReturnType<typeof toUserSummary>>()
  return toAdminImageItem(updatedRow, userId ? users.get(userId) : undefined)
}
