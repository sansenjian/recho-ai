import { getSupabaseAdminClient } from '../clients/supabase.js'
import type { RequestUser } from './request-auth.js'

const ANNOUNCEMENTS_TABLE = 'announcements'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 60

export type AnnouncementStatus = 'draft' | 'published' | 'archived'

export interface AnnouncementItem {
  id: string
  title: string
  body: string
  status: AnnouncementStatus
  createdBy: string | null
  updatedBy: string | null
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export class AdminAnnouncementError extends Error {
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.status = options.status ?? 400
    this.publicMessage = options.publicMessage ?? '公告操作失败，请稍后重试。'
  }
}

function requireAnnouncementClient() {
  const client = getSupabaseAdminClient()
  if (!client) throw new AdminAnnouncementError('announcement_service_unavailable', {
    status: 503,
    publicMessage: '公告服务暂时不可用。',
  })
  return client
}

function sanitizedLimit(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(number)))
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' && value ? value : null
}

function sanitizedStatus(value: unknown): AnnouncementStatus | null {
  return value === 'draft' || value === 'published' || value === 'archived'
    ? value
    : null
}

function sanitizeTitle(value: unknown) {
  if (typeof value !== 'string') return null
  const title = value.replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, 120) : null
}

function sanitizeBody(value: unknown) {
  if (typeof value !== 'string') return null
  const body = value.trim()
  return body ? body.slice(0, 4000) : null
}

function toAnnouncement(row: Record<string, unknown>): AnnouncementItem {
  return {
    id: String(row.id || ''),
    title: stringField(row, 'title') || '',
    body: stringField(row, 'body') || '',
    status: sanitizedStatus(row.status) || 'draft',
    createdBy: stringField(row, 'created_by'),
    updatedBy: stringField(row, 'updated_by'),
    publishedAt: stringField(row, 'published_at'),
    createdAt: stringField(row, 'created_at'),
    updatedAt: stringField(row, 'updated_at'),
  }
}

export async function listAdminAnnouncements(options: {
  limit?: unknown
  status?: unknown
} = {}) {
  const client = requireAnnouncementClient()
  const status = sanitizedStatus(options.status)
  let query = client
    .from(ANNOUNCEMENTS_TABLE)
    .select('id,title,body,status,created_by,updated_by,published_at,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(sanitizedLimit(options.limit))

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error
  return ((data || []) as Array<Record<string, unknown>>).map(toAnnouncement)
}

export async function listPublishedAnnouncements(options: { limit?: unknown } = {}) {
  const client = requireAnnouncementClient()
  const { data, error } = await client
    .from(ANNOUNCEMENTS_TABLE)
    .select('id,title,body,status,published_at,created_at,updated_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(sanitizedLimit(options.limit))

  if (error) throw error
  return ((data || []) as Array<Record<string, unknown>>).map(toAnnouncement)
}

export async function createAdminAnnouncement(input: Record<string, unknown>, adminUser: RequestUser) {
  const title = sanitizeTitle(input.title)
  const body = sanitizeBody(input.body)
  const status = sanitizedStatus(input.status) || 'published'
  if (!title || !body) throw new AdminAnnouncementError('invalid_announcement', {
    publicMessage: '请输入公告标题和内容。',
  })

  const now = new Date().toISOString()
  const client = requireAnnouncementClient()
  const { data, error } = await client
    .from(ANNOUNCEMENTS_TABLE)
    .insert({
      title,
      body,
      status,
      created_by: adminUser.id,
      updated_by: adminUser.id,
      published_at: status === 'published' ? now : null,
      updated_at: now,
    })
    .select('id,title,body,status,created_by,updated_by,published_at,created_at,updated_at')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new AdminAnnouncementError('announcement_not_created')
  return toAnnouncement(data as Record<string, unknown>)
}

export async function updateAdminAnnouncement(
  announcementId: string,
  input: Record<string, unknown>,
  adminUser: RequestUser,
) {
  if (!isUuid(announcementId)) throw new AdminAnnouncementError('invalid_announcement_id', {
    publicMessage: '公告 ID 无效。',
  })

  const patch: Record<string, unknown> = {
    updated_by: adminUser.id,
    updated_at: new Date().toISOString(),
  }

  if ('title' in input) {
    const title = sanitizeTitle(input.title)
    if (!title) throw new AdminAnnouncementError('invalid_announcement', {
      publicMessage: '请输入公告标题。',
    })
    patch.title = title
  }

  if ('body' in input) {
    const body = sanitizeBody(input.body)
    if (!body) throw new AdminAnnouncementError('invalid_announcement', {
      publicMessage: '请输入公告内容。',
    })
    patch.body = body
  }

  if ('status' in input) {
    const status = sanitizedStatus(input.status)
    if (!status) throw new AdminAnnouncementError('invalid_announcement_status', {
      publicMessage: '公告状态无效。',
    })
    patch.status = status
    if (status === 'published') patch.published_at = patch.updated_at
  }

  if (Object.keys(patch).length <= 2) throw new AdminAnnouncementError('invalid_announcement_update')

  const client = requireAnnouncementClient()
  const { data, error } = await client
    .from(ANNOUNCEMENTS_TABLE)
    .update(patch)
    .eq('id', announcementId)
    .select('id,title,body,status,created_by,updated_by,published_at,created_at,updated_at')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new AdminAnnouncementError('announcement_not_found', {
    status: 404,
    publicMessage: '公告不存在。',
  })
  return toAnnouncement(data as Record<string, unknown>)
}
