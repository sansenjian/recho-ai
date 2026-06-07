import type { User } from '@supabase/supabase-js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { redactSensitiveText } from './safe-error.js'

const IMAGE_ATTEMPTS_TABLE = 'image_generation_attempts'
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100
const RECENT_HOURS = 24
const ADMIN_ATTEMPT_COLUMNS = [
  'id',
  'generation_id',
  'user_id',
  'status',
  'latency_ms',
  'error_type',
  'error_code',
  'error_message',
  'http_status',
  'created_at',
].join(',')

type AttemptStatus = 'succeeded' | 'failed'

export interface AdminImageAttemptItem {
  id: string
  generationId: string | null
  userId: string | null
  email: string | null
  status: AttemptStatus
  latencyMs: number | null
  errorType: string | null
  errorCode: string | null
  errorMessage: string | null
  httpStatus: number | null
  createdAt: string | null
}

export interface AdminImageAttemptOverview {
  total: number
  succeeded: number
  failed: number
  failureRate: number
  averageLatencyMs: number | null
  byErrorType: Array<{
    errorType: string
    count: number
  }>
}

export class AdminImageAttemptError extends Error {
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.status = options.status ?? 400
    this.publicMessage = options.publicMessage ?? publicMessageForAttemptError(code)
  }
}

function publicMessageForAttemptError(code: string) {
  if (code === 'attempt_service_unavailable') return '生图监控服务暂时不可用。'
  return '生图监控加载失败，请稍后重试。'
}

function requireAttemptClient() {
  const client = getSupabaseAdminClient()
  if (!client) throw new AdminImageAttemptError('attempt_service_unavailable', { status: 503 })
  return client
}

function sanitizedLimit(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(number)))
}

function sanitizedStatus(value: unknown): AttemptStatus | null {
  return value === 'succeeded' || value === 'failed' ? value : null
}

function normalizedInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null
}

function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' && value ? value : null
}

function safeDisplayText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim()) return null
  return redactSensitiveText(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength) || null
}

function toUserSummary(user: User) {
  return {
    id: user.id,
    email: user.email || null,
  }
}

export function toAdminImageAttemptItem(
  row: Record<string, unknown>,
  user?: ReturnType<typeof toUserSummary>,
): AdminImageAttemptItem {
  const status = sanitizedStatus(row.status) || 'failed'

  return {
    id: String(row.id || ''),
    generationId: stringField(row, 'generation_id'),
    userId: stringField(row, 'user_id'),
    email: user?.email || null,
    status,
    latencyMs: nullableInteger(row.latency_ms),
    errorType: safeDisplayText(row.error_type, 80),
    errorCode: safeDisplayText(row.error_code, 80),
    errorMessage: safeDisplayText(row.error_message, 240),
    httpStatus: nullableInteger(row.http_status),
    createdAt: stringField(row, 'created_at'),
  }
}

export function summarizeAdminImageAttempts(rows: Array<Record<string, unknown>>): AdminImageAttemptOverview {
  let succeeded = 0
  let failed = 0
  let latencyTotal = 0
  let latencyCount = 0
  const byErrorType = new Map<string, number>()

  for (const row of rows) {
    const status = sanitizedStatus(row.status)
    if (status === 'succeeded') succeeded += 1
    if (status === 'failed') {
      failed += 1
      const errorType = safeDisplayText(row.error_type, 80) || 'unknown'
      byErrorType.set(errorType, (byErrorType.get(errorType) || 0) + 1)
    }

    const latencyMs = nullableInteger(row.latency_ms)
    if (latencyMs !== null) {
      latencyTotal += latencyMs
      latencyCount += 1
    }
  }

  const total = succeeded + failed

  return {
    total,
    succeeded,
    failed,
    failureRate: total ? Math.round((failed / total) * 1000) / 10 : 0,
    averageLatencyMs: latencyCount ? Math.round(latencyTotal / latencyCount) : null,
    byErrorType: Array.from(byErrorType.entries())
      .map(([errorType, count]) => ({ errorType, count }))
      .sort((left, right) => right.count - left.count || left.errorType.localeCompare(right.errorType))
      .slice(0, 6),
  }
}

async function usersById(userIds: string[]) {
  const client = requireAttemptClient()
  const users = new Map<string, ReturnType<typeof toUserSummary>>()

  await Promise.all(userIds.map(async userId => {
    const { data, error } = await client.auth.admin.getUserById(userId)
    if (!error && data.user) {
      users.set(userId, toUserSummary(data.user))
    }
  }))

  return users
}

export async function listAdminImageAttempts(options: {
  limit?: unknown
  status?: unknown
} = {}) {
  const client = requireAttemptClient()
  const limit = sanitizedLimit(options.limit)
  const status = sanitizedStatus(options.status)
  const cutoff = new Date(Date.now() - RECENT_HOURS * 60 * 60 * 1000).toISOString()

  let recentQuery = client
    .from(IMAGE_ATTEMPTS_TABLE)
    .select(ADMIN_ATTEMPT_COLUMNS)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })

  if (status) recentQuery = recentQuery.eq('status', status)

  recentQuery = recentQuery.limit(500)

  const { data, error } = await recentQuery
  if (error) throw error

  const rows = (data || []) as unknown as Array<Record<string, unknown>>
  const listedRows = rows.slice(0, limit)
  const userIds = Array.from(new Set(
    listedRows
      .map(row => stringField(row, 'user_id'))
      .filter((userId): userId is string => Boolean(userId)),
  ))
  const users = await usersById(userIds)

  return {
    overview: summarizeAdminImageAttempts(rows),
    attempts: listedRows.map(row => toAdminImageAttemptItem(row, users.get(String(row.user_id || '')))),
  }
}
