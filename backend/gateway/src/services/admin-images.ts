import { getSupabaseAdminClient } from '../clients/supabase.js'
import { cachedAdminUsersById, type AdminUserSummary } from './admin-user-cache.js'
import { roundCreditAmount } from './image-credit-cost.js'
import { imagePublicUrl, removeImageStoragePaths } from './image-storage.js'
import { redactSensitiveText } from './safe-error.js'

const IMAGE_HISTORY_TABLE = 'image_generations'
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 60
const MAX_BULK_IDS = 60
const ADMIN_IMAGE_COLUMNS = [
  'id',
  'user_id',
  'storage_path',
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
  'provider',
  'image_model',
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
  storagePath: string | null
  storageLocation: string | null
  provider: string | null
  imageModel: string | null
}

export interface AdminImageStorageStat {
  location: 'cos' | 'supabase' | 'data' | 'unknown'
  imageCount: number
  totalBytes: number
  averageBytes: number
  totalCreditCost: number
}

export interface AdminImageStorageOverview {
  generatedAt: string
  totalImages: number
  totalBytes: number
  totalCreditCost: number
  byLocation: AdminImageStorageStat[]
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
  if (code === 'invalid_image_ids') return '请选择有效的图片。'
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

function sanitizedImageId(value: unknown) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id && id.length <= 160 ? id : null
}

function sanitizedImageIds(value: unknown) {
  if (!Array.isArray(value)) throw new AdminImageError('invalid_image_ids')
  const ids = Array.from(new Set(value.map(sanitizedImageId)))
  if (!ids.length || ids.length > MAX_BULK_IDS || ids.some(id => !id)) {
    throw new AdminImageError('invalid_image_ids')
  }
  return ids as string[]
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

function storagePathsFromRows(rows: Array<Record<string, unknown>>) {
  return rows.flatMap(row => [
    stringField(row, 'storage_path'),
    stringField(row, 'preview_path'),
    stringField(row, 'thumbnail_path'),
  ])
}

function assertAllRequestedImagesFound(rows: Array<Record<string, unknown>>, idsRequested: string[]) {
  const foundIds = new Set(rows.map(row => String(row.id || '')).filter(Boolean))
  if (foundIds.size !== idsRequested.length || idsRequested.some(id => !foundIds.has(id))) {
    throw new AdminImageError('image_not_found')
  }
}

function cleanupDeletedImageStorage(rows: Array<Record<string, unknown>>) {
  const paths = storagePathsFromRows(rows)
  void removeImageStoragePaths(paths).catch((error) => {
    console.warn('[admin-images] failed to remove deleted image storage paths', error)
  })
}

function normalizedInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function normalizedCreditAmount(value: unknown) {
  return Math.max(0, roundCreditAmount(value))
}

function storageLocationFromPath(storagePath: string | null): 'cos' | 'supabase' | 'data' | null {
  if (!storagePath) return null
  if (storagePath.startsWith('cos://')) return 'cos'
  if (storagePath.startsWith('data:')) return 'data'
  return 'supabase'
}

export function toAdminImageItem(
  row: Record<string, unknown>,
  user?: AdminUserSummary,
): AdminImageItem {
  const previewPath = stringField(row, 'preview_path')
  const thumbnailPath = stringField(row, 'thumbnail_path')
  const storagePath = stringField(row, 'storage_path')
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
    creditCost: normalizedCreditAmount(row.credit_cost),
    size: stringField(row, 'size'),
    aspectRatio: stringField(row, 'aspect_ratio'),
    resolution: stringField(row, 'resolution'),
    quality: stringField(row, 'quality'),
    generatedAt: stringField(row, 'generated_at'),
    storagePath,
    storageLocation: storageLocationFromPath(storagePath),
    provider: stringField(row, 'provider'),
    imageModel: stringField(row, 'image_model'),
  }
}

async function usersById(userIds: string[]) {
  const client = requireAdminImageClient()
  return await cachedAdminUsersById(client, userIds)
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
  const imageId = sanitizedImageId(id)
  if (!imageId) throw new AdminImageError('invalid_image_id')
  const visibility = sanitizedVisibility(visibilityValue)
  if (!visibility) throw new AdminImageError('invalid_visibility')

  const client = requireAdminImageClient()
  const { data: existing, error: lookupError } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select(ADMIN_IMAGE_COLUMNS)
    .eq('id', imageId)
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
    .eq('id', imageId)
    .select(ADMIN_IMAGE_COLUMNS)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new AdminImageError('image_not_found')

  const updatedRow = data as unknown as Record<string, unknown>
  const userId = stringField(updatedRow, 'user_id')
  const users = userId ? await usersById([userId]) : new Map<string, AdminUserSummary>()
  return toAdminImageItem(updatedRow, userId ? users.get(userId) : undefined)
}

export async function bulkSetAdminImageVisibility(idsValue: unknown, visibilityValue: unknown) {
  const idsRequested = sanitizedImageIds(idsValue)
  const visibility = sanitizedVisibility(visibilityValue)
  if (!visibility) throw new AdminImageError('invalid_visibility')

  const client = requireAdminImageClient()
  const { data: existing, error: lookupError } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select(ADMIN_IMAGE_COLUMNS)
    .in('id', idsRequested)

  if (lookupError) throw lookupError
  const existingRows = (existing || []) as unknown as Array<Record<string, unknown>>
  assertAllRequestedImagesFound(existingRows, idsRequested)

  if (visibility === 'public' && existingRows.some(row => stringField(row, 'funding_source') === 'credit')) {
    throw new AdminImageError('credit_image_must_stay_private')
  }

  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .update({ visibility })
    .in('id', idsRequested)
    .select(ADMIN_IMAGE_COLUMNS)

  if (error) throw error
  const updatedRows = (data || []) as unknown as Array<Record<string, unknown>>
  const userIds = Array.from(new Set(
    updatedRows
      .map(row => stringField(row, 'user_id'))
      .filter((userId): userId is string => Boolean(userId)),
  ))
  const users = await usersById(userIds)

  return updatedRows.map(row => toAdminImageItem(row, users.get(String(row.user_id || ''))))
}

export async function bulkArchiveAdminImages(idsValue: unknown) {
  return await bulkSetAdminImageVisibility(idsValue, 'private')
}

export async function bulkDeleteAdminImages(idsValue: unknown) {
  const idsRequested = sanitizedImageIds(idsValue)
  const client = requireAdminImageClient()

  const { data: existing, error: lookupError } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select(ADMIN_IMAGE_COLUMNS)
    .in('id', idsRequested)

  if (lookupError) throw lookupError
  const existingRows = (existing || []) as unknown as Array<Record<string, unknown>>
  assertAllRequestedImagesFound(existingRows, idsRequested)

  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .delete()
    .in('id', idsRequested)
    .select(ADMIN_IMAGE_COLUMNS)

  if (error) throw error
  const deletedRows = (data || []) as unknown as Array<Record<string, unknown>>
  assertAllRequestedImagesFound(deletedRows, idsRequested)

  cleanupDeletedImageStorage(deletedRows)

  return {
    deletedIds: deletedRows.map(row => String(row.id || '')).filter(Boolean),
    deletedCount: deletedRows.length,
  }
}

function parseSizeToBytes(size: string | null): number {
  if (!size) return 0
  const match = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|bytes|KBytes|Bytes)?$/i.exec(size.trim())
  if (!match) return 0
  const value = Number(match[1])
  const unit = (match[2] || '').toLowerCase()
  switch (unit) {
    case 'kb':
    case 'kbytes':
      return Math.round(value * 1024)
    case 'mb':
      return Math.round(value * 1024 * 1024)
    case 'gb':
      return Math.round(value * 1024 * 1024 * 1024)
    case 'bytes':
    case '':
      return Math.round(value)
    default:
      return Math.round(value)
  }
}

function storageLocationFromRpc(value: unknown): AdminImageStorageStat['location'] {
  const location = String(value || 'unknown')
  return location === 'cos' || location === 'supabase' || location === 'data'
    ? location
    : 'unknown'
}

function storageStatFromRows(rows: Array<Record<string, unknown>>): AdminImageStorageStat[] {
  const stats = new Map<AdminImageStorageStat['location'], AdminImageStorageStat>()

  for (const row of rows) {
    const location = storageLocationFromPath(stringField(row, 'storage_path')) || 'supabase'
    const current = stats.get(location) || {
      location,
      imageCount: 0,
      totalBytes: 0,
      averageBytes: 0,
      totalCreditCost: 0,
    }
    current.imageCount += 1
    current.totalBytes += parseSizeToBytes(stringField(row, 'size'))
    current.totalCreditCost = Math.round((current.totalCreditCost + normalizedCreditAmount(row.credit_cost)) * 100) / 100
    stats.set(location, current)
  }

  return Array.from(stats.values()).map(stat => ({
    ...stat,
    averageBytes: stat.imageCount > 0 ? Math.round(stat.totalBytes / stat.imageCount) : 0,
  }))
}

async function storageOverviewFromRows(): Promise<AdminImageStorageStat[]> {
  const client = requireAdminImageClient()
  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select('storage_path,size,credit_cost')

  if (error) throw error
  return storageStatFromRows((data || []) as unknown as Array<Record<string, unknown>>)
}

function storageOverviewResponse(byLocation: AdminImageStorageStat[]): AdminImageStorageOverview {
  byLocation.sort((a, b) => b.totalBytes - a.totalBytes)

  const totalImages = byLocation.reduce((sum, stat) => sum + stat.imageCount, 0)
  const totalBytes = byLocation.reduce((sum, stat) => sum + stat.totalBytes, 0)
  const totalCreditCost = byLocation.reduce((sum, stat) => sum + stat.totalCreditCost, 0)

  return {
    generatedAt: new Date().toISOString(),
    totalImages,
    totalBytes,
    totalCreditCost: Math.round(totalCreditCost * 100) / 100,
    byLocation,
  }
}

export async function getAdminImageStorageOverview(): Promise<AdminImageStorageOverview> {
  const client = requireAdminImageClient()
  const { data: statsRows, error } = await client
    .rpc('admin_image_storage_overview')

  if (error) {
    console.warn('[admin-images] storage overview RPC failed; falling back to table scan', error)
    return storageOverviewResponse(await storageOverviewFromRows())
  }

  const rows = (statsRows || []) as unknown as Array<Record<string, unknown>>
  const byLocation: AdminImageStorageStat[] = rows.map(row => ({
    location: storageLocationFromRpc(row.location),
    imageCount: Number(row.image_count || 0),
    totalBytes: Number(row.total_bytes || 0),
    averageBytes: Number(row.image_count || 0) > 0
      ? Math.round(Number(row.total_bytes || 0) / Number(row.image_count || 1))
      : 0,
    totalCreditCost: Math.round(Number(row.total_credit_cost || 0) * 100) / 100,
  }))

  return storageOverviewResponse(byLocation)
}
