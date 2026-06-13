import type { User } from '@supabase/supabase-js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import {
  DEFAULT_APP_SETTINGS,
  getAdminAccessSummary,
  getAppSettings,
  isConfiguredAdminUser as isConfiguredAdminUserFromSettings,
} from './app-settings.js'
import { createRandomCreditCode, creditCodeHash, normalizeCreditCode } from './credit-code.js'
import {
  normalizeImageCreditCostPerImage,
  roundCreditAmount,
} from './image-credit-cost.js'
import { redactSensitiveText } from './safe-error.js'
import type { RequestUser } from './request-auth.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const CODE_FILTER_PAGE_SIZE = 500
const OVERVIEW_PAGE_SIZE = 1000
const RECENT_TRANSACTION_DAYS = 7
const CREDIT_TRANSACTION_REASONS = ['redemption', 'image_generation', 'refund', 'admin_adjustment'] as const
const CREDIT_CODE_STATES = ['active', 'disabled', 'expired', 'exhausted'] as const
const BYTES_PER_MIB = 1024 * 1024
const BYTES_PER_GIB = 1024 * 1024 * 1024

export type { RequestUser } from './request-auth.js'

export interface AdminCreditUser {
  userId: string
  email: string | null
  balance: number
  totalRedeemed: number
  totalSpent: number
  createdAt: string | null
  updatedAt: string | null
  lastSignInAt: string | null
}

export interface AdminCreditCode {
  id: string
  credits: number
  maxRedemptions: number
  redeemedCount: number
  expiresAt: string | null
  disabledAt: string | null
  note: string | null
  createdAt: string | null
}

export type AdminCreditCodeState = typeof CREDIT_CODE_STATES[number]

export interface CreatedAdminCreditCode extends AdminCreditCode {
  code: string
}

export interface AdminCreditOverview {
  users: {
    withCreditRows: number
    totalBalance: number
    totalRedeemed: number
    totalSpent: number
  }
  codes: {
    total: number
    active: number
    disabled: number
    expired: number
    exhausted: number
    totalIssuedCredits: number
    totalRedeemedCredits: number
  }
  transactions: {
    last7Days: {
      totalCount: number
      redeemedCredits: number
      spentCredits: number
      refundedCredits: number
      adminAdjustedCredits: number
    }
    byReason: Array<{
      reason: string
      count: number
      amount: number
    }>
  }
  settings: {
    imageCreditCostPerImage: number
  }
  imageCost: AdminImageCostOverview
  generatedAt: string
}

export interface AdminImageCostOverview {
  sampleDays: number
  imageSampleSize: number
  attemptSampleSize: number
  averageTrafficMb: number
  averageStoredMb: number
  averageLatencyMs: number | null
  gatewayMemoryMb: number
  estimatedMemoryMbSeconds: number | null
  estimatedCostScore: number | null
  confidence: 'none' | 'low' | 'medium' | 'high'
  cosStorageCostPerImage: number
  cosTrafficCostPerImage: number
  supabaseStorageCostPerImage: number
  supabaseTrafficCostPerImage: number
  renderTrafficCostPerImage: number
  totalCostPerImage: number
  estimatedMonthlyCost: number
  cosImageCount: number
  supabaseImageCount: number
}

export interface AdminCreditLedgerEntry {
  id: string
  userId: string
  email: string | null
  amount: number
  balanceAfter: number
  reason: string
  note: string | null
  generationId: string | null
  redemptionId: string | null
  relatedTransactionId: string | null
  details: {
    count: number | null
    creditCostPerImage: number | null
    creditCost: number | null
    size: string | null
    aspectRatio: string | null
    resolution: string | null
    quality: string | null
    referenceCount: number | null
    refundReason: string | null
  }
  createdAt: string | null
}

export interface AdminCreditCodeRedemption {
  id: string
  userId: string
  email: string | null
  credits: number
  redeemedAt: string | null
  transactionId: string | null
  balanceAfter: number | null
}

export class AdminCreditError extends Error {
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.status = options.status ?? statusForAdminCreditError(code)
    this.publicMessage = options.publicMessage ?? publicMessageForAdminCreditError(code)
  }
}

function statusForAdminCreditError(code: string) {
  if (code === 'auth_required') return 401
  if (code === 'admin_forbidden') return 403
  if (code === 'admin_not_configured') return 403
  if (code === 'insufficient_credits') return 409
  if (code === 'admin_service_unavailable') return 503
  return 400
}

function publicMessageForAdminCreditError(code: string) {
  if (code === 'auth_required') return '请先登录。'
  if (code === 'admin_forbidden') return '当前账号没有后台权限。'
  if (code === 'admin_not_configured') return '后台管理员尚未配置。'
  if (code === 'invalid_credit_amount') return '额度数量无效。'
  if (code === 'insufficient_credits') return '用户额度不足，不能扣到负数。'
  if (code === 'invalid_user_id') return '用户 ID 无效。'
  if (code === 'invalid_code_id') return '兑换码 ID 无效。'
  if (code === 'admin_service_unavailable') return '后台服务暂时不可用。'
  return '后台操作失败，请稍后重试。'
}

function adminErrorCode(error: unknown) {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {}
  const message = [
    error instanceof Error ? error.message : typeof error === 'string' ? error : '',
    record.message,
    record.details,
    record.hint,
    record.code,
  ]
    .filter(Boolean)
    .join(' ')
  const match = /\b(auth_required|insufficient_credits|invalid_credit_amount|invalid_user_id|invalid_code_id)\b/.exec(message)
  return match?.[1] || 'admin_operation_failed'
}

function requireAdminClient() {
  const client = getSupabaseAdminClient()
  if (!client) throw new AdminCreditError('admin_service_unavailable')
  return client
}

function normalizedInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function normalizedSignedInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : 0
}

function normalizedCreditAmount(value: unknown) {
  return Math.max(0, roundCreditAmount(value))
}

function normalizedSignedCreditAmount(value: unknown) {
  return roundCreditAmount(value)
}

function normalizedBytes(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function roundedMetric(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function memorySnapshotMb() {
  return roundedMetric(process.memoryUsage().rss / BYTES_PER_MIB, 1)
}

function normalizedCodeUses(value: unknown) {
  const number = normalizedInteger(value)
  return number > 0 ? number : 1
}

function sanitizedLimit(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(number)))
}

function sanitizedReason(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const reason = value.trim()
  return (CREDIT_TRANSACTION_REASONS as readonly string[]).includes(reason) ? reason : null
}

function sanitizedCodeState(value: unknown): AdminCreditCodeState | null {
  return typeof value === 'string' && (CREDIT_CODE_STATES as readonly string[]).includes(value)
    ? value as AdminCreditCodeState
    : null
}

function sanitizeText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function sanitizeSearchText(value: unknown, maxLength = 80) {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/[%,()*_\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  return text || null
}

function safeDisplayText(value: unknown, maxLength = 240) {
  const text = sanitizeText(value, maxLength)
  return text ? redactSensitiveText(text) : null
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new AdminCreditError('invalid_expires_at')
  return date.toISOString()
}

function expiresAtFromOptions(value: unknown, days: unknown) {
  const explicit = parseDate(value)
  if (explicit) return explicit

  const dayCount = Number(days)
  if (!Number.isFinite(dayCount) || dayCount <= 0) return null
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + Math.round(dayCount))
  return date.toISOString()
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function toUserSummary(user: User) {
  return {
    id: user.id,
    email: user.email || null,
    createdAt: user.created_at || null,
    lastSignInAt: user.last_sign_in_at || null,
  }
}

function toCreditUser(
  userId: string,
  user: ReturnType<typeof toUserSummary> | undefined,
  balance: Record<string, unknown> | undefined,
): AdminCreditUser {
  return {
    userId,
    email: user?.email || null,
    balance: normalizedCreditAmount(balance?.balance),
    totalRedeemed: normalizedCreditAmount(balance?.total_redeemed),
    totalSpent: normalizedCreditAmount(balance?.total_spent),
    createdAt: typeof balance?.created_at === 'string' ? balance.created_at : user?.createdAt || null,
    updatedAt: typeof balance?.updated_at === 'string' ? balance.updated_at : null,
    lastSignInAt: user?.lastSignInAt || null,
  }
}

function toCreditCode(row: Record<string, unknown>): AdminCreditCode {
  return {
    id: String(row.id || ''),
    credits: normalizedInteger(row.credits),
    maxRedemptions: normalizedInteger(row.max_redemptions),
    redeemedCount: normalizedInteger(row.redeemed_count),
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    disabledAt: typeof row.disabled_at === 'string' ? row.disabled_at : null,
    note: safeDisplayText(row.note, 240),
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  }
}

function toCreditCodeRedemption(
  row: Record<string, unknown>,
  user?: ReturnType<typeof toUserSummary>,
  transaction?: Record<string, unknown>,
): AdminCreditCodeRedemption {
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    email: user?.email || null,
    credits: normalizedInteger(row.credits),
    redeemedAt: stringField(row, 'redeemed_at'),
    transactionId: transaction ? String(transaction.id || '') || null : null,
    balanceAfter: transaction ? normalizedCreditAmount(transaction.balance_after) : null,
  }
}

function creditCodeState(row: Record<string, unknown>, nowMs: number): AdminCreditCodeState {
  if (row.disabled_at) return 'disabled'
  if (typeof row.expires_at === 'string' && new Date(row.expires_at).getTime() <= nowMs) return 'expired'

  const maxRedemptions = normalizedCodeUses(row.max_redemptions)
  if (normalizedInteger(row.redeemed_count) >= maxRedemptions) return 'exhausted'

  return 'active'
}

function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' && value ? value : null
}

function metadataRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function usersById(client: ReturnType<typeof requireAdminClient>, userIds: string[]) {
  const users = new Map<string, ReturnType<typeof toUserSummary>>()

  await Promise.all(userIds.map(async userId => {
    const { data: userData, error: userError } = await client.auth.admin.getUserById(userId)
    if (!userError && userData.user) {
      users.set(userId, toUserSummary(userData.user))
    }
  }))

  return users
}

function toLedgerDetails(metadata: Record<string, unknown>) {
  return {
    count: Number.isFinite(Number(metadata.count)) ? normalizedInteger(metadata.count) : null,
    creditCostPerImage: Number.isFinite(Number(metadata.creditCostPerImage)) ? normalizedCreditAmount(metadata.creditCostPerImage) : null,
    creditCost: Number.isFinite(Number(metadata.creditCost)) ? normalizedCreditAmount(metadata.creditCost) : null,
    size: safeDisplayText(metadata.size, 32),
    aspectRatio: safeDisplayText(metadata.aspectRatio, 24),
    resolution: safeDisplayText(metadata.resolution, 24),
    quality: safeDisplayText(metadata.quality, 24),
    referenceCount: Number.isFinite(Number(metadata.referenceCount)) ? normalizedInteger(metadata.referenceCount) : null,
    refundReason: safeDisplayText(metadata.reason, 80),
  }
}

export function toAdminCreditLedgerEntry(
  row: Record<string, unknown>,
  user?: ReturnType<typeof toUserSummary>,
): AdminCreditLedgerEntry {
  const metadata = metadataRecord(row.metadata)

  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    email: user?.email || null,
    amount: normalizedSignedCreditAmount(row.amount),
    balanceAfter: normalizedCreditAmount(row.balance_after),
    reason: typeof row.reason === 'string' && row.reason ? row.reason : 'unknown',
    note: safeDisplayText(metadata.note, 240),
    generationId: stringField(row, 'generation_id'),
    redemptionId: stringField(row, 'redemption_id'),
    relatedTransactionId: stringField(row, 'related_transaction_id'),
    details: toLedgerDetails(metadata),
    createdAt: stringField(row, 'created_at'),
  }
}

export function summarizeAdminCreditOverview(input: {
  balanceRows?: Array<Record<string, unknown>>
  codeRows?: Array<Record<string, unknown>>
  transactionRows?: Array<Record<string, unknown>>
  imageRows?: Array<Record<string, unknown>>
  attemptRows?: Array<Record<string, unknown>>
  gatewayMemoryMb?: number
  now?: Date
  imageCreditCostPerImage?: number
}): Omit<AdminCreditOverview, 'generatedAt'> {
  const now = input.now || new Date()
  const nowMs = now.getTime()
  const cutoffMs = nowMs - RECENT_TRANSACTION_DAYS * 24 * 60 * 60 * 1000

  const users = {
    withCreditRows: 0,
    totalBalance: 0,
    totalRedeemed: 0,
    totalSpent: 0,
  }

  for (const row of input.balanceRows || []) {
    users.withCreditRows += 1
    users.totalBalance += normalizedCreditAmount(row.balance)
    users.totalRedeemed += normalizedCreditAmount(row.total_redeemed)
    users.totalSpent += normalizedCreditAmount(row.total_spent)
  }

  const codes = {
    total: 0,
    active: 0,
    disabled: 0,
    expired: 0,
    exhausted: 0,
    totalIssuedCredits: 0,
    totalRedeemedCredits: 0,
  }

  for (const row of input.codeRows || []) {
    const credits = normalizedInteger(row.credits)
    const maxRedemptions = normalizedCodeUses(row.max_redemptions)
    const redeemedCount = normalizedInteger(row.redeemed_count)
    const state = creditCodeState(row, nowMs)

    codes.total += 1
    codes[state] += 1
    codes.totalIssuedCredits += credits * maxRedemptions
    codes.totalRedeemedCredits += credits * Math.min(redeemedCount, maxRedemptions)
  }

  const reasonTotals = new Map<string, { reason: string; count: number; amount: number }>()
  const last7Days = {
    totalCount: 0,
    redeemedCredits: 0,
    spentCredits: 0,
    refundedCredits: 0,
    adminAdjustedCredits: 0,
  }

  for (const reason of CREDIT_TRANSACTION_REASONS) {
    reasonTotals.set(reason, { reason, count: 0, amount: 0 })
  }

  for (const row of input.transactionRows || []) {
    const createdAt = typeof row.created_at === 'string' ? new Date(row.created_at).getTime() : Number.NaN
    if (Number.isNaN(createdAt) || createdAt < cutoffMs || createdAt > nowMs) continue

    const reason = typeof row.reason === 'string' && row.reason ? row.reason : 'unknown'
    const amount = normalizedSignedCreditAmount(row.amount)
    const total = reasonTotals.get(reason) || { reason, count: 0, amount: 0 }

    total.count += 1
    total.amount += amount
    reasonTotals.set(reason, total)

    last7Days.totalCount += 1
    if (reason === 'redemption') last7Days.redeemedCredits += Math.max(0, amount)
    if (reason === 'image_generation') last7Days.spentCredits += Math.abs(Math.min(0, amount))
    if (reason === 'refund') last7Days.refundedCredits += Math.max(0, amount)
    if (reason === 'admin_adjustment') last7Days.adminAdjustedCredits += amount
  }

  const imageRows = input.imageRows || []
  let storedBytesTotal = 0
  let trafficBytesTotal = 0
  let cosStoredBytes = 0
  let cosTrafficBytes = 0
  let supabaseStoredBytes = 0
  let supabaseTrafficBytes = 0
  let cosImageCount = 0
  let supabaseImageCount = 0

  for (const row of imageRows) {
    const originalBytes = normalizedBytes(row.original_bytes)
    const previewBytes = normalizedBytes(row.preview_bytes)
    const thumbnailBytes = normalizedBytes(row.thumbnail_bytes)
    const stored = originalBytes + previewBytes + thumbnailBytes
    const traffic = previewBytes || thumbnailBytes || originalBytes
    storedBytesTotal += stored
    trafficBytesTotal += traffic

    if (row.funding_source === 'credit') {
      cosStoredBytes += stored
      cosTrafficBytes += traffic
      cosImageCount++
    } else {
      supabaseStoredBytes += stored
      supabaseTrafficBytes += traffic
      supabaseImageCount++
    }
  }

  const attemptRows = input.attemptRows || []
  let latencyTotal = 0
  let latencyCount = 0
  for (const row of attemptRows) {
    const latencyMs = normalizedInteger(row.latency_ms)
    if (latencyMs > 0) {
      latencyTotal += latencyMs
      latencyCount += 1
    }
  }

  const imageSampleSize = imageRows.length
  const attemptSampleSize = attemptRows.length
  const averageTrafficMb = imageSampleSize ? roundedMetric((trafficBytesTotal / imageSampleSize) / BYTES_PER_MIB) : 0
  const averageStoredMb = imageSampleSize ? roundedMetric((storedBytesTotal / imageSampleSize) / BYTES_PER_MIB) : 0
  const averageLatencyMs = latencyCount ? Math.round(latencyTotal / latencyCount) : null
  const gatewayMemoryMb = Math.max(0, roundedMetric(Number(input.gatewayMemoryMb) || 0, 1))
  const averageLatencySeconds = averageLatencyMs === null ? null : averageLatencyMs / 1000
  const estimatedMemoryMbSeconds = null

  // Pricing constants (CNY per GB)
  const CNY_PER_USD = 7.2
  const COS_STORAGE_CNY_PER_GB = 0.118       // 腾讯云COS标准存储 广州 按量计费
  const COS_TRAFFIC_CNY_PER_GB = 0.50         // 腾讯云COS外网流出流量 中国大陆
  const SUPABASE_STORAGE_USD_PER_GB = 0.0213  // Supabase Pro plan storage
  const SUPABASE_TRAFFIC_USD_PER_GB = 0.09    // Supabase Pro plan egress
  const RENDER_TRAFFIC_USD_PER_GB = 0.15      // Render web service egress

  const avgCosStoredGb = cosImageCount ? (cosStoredBytes / cosImageCount) / BYTES_PER_GIB : 0
  const avgCosTrafficGb = cosImageCount ? (cosTrafficBytes / cosImageCount) / BYTES_PER_GIB : 0
  const avgSupabaseStoredGb = supabaseImageCount ? (supabaseStoredBytes / supabaseImageCount) / BYTES_PER_GIB : 0
  const avgSupabaseTrafficGb = supabaseImageCount ? (supabaseTrafficBytes / supabaseImageCount) / BYTES_PER_GIB : 0

  const cosStorageCostPerImage = roundedMetric(avgCosStoredGb * COS_STORAGE_CNY_PER_GB, 4)
  const cosTrafficCostPerImage = roundedMetric(avgCosTrafficGb * COS_TRAFFIC_CNY_PER_GB, 4)
  const supabaseStorageCostPerImage = roundedMetric(avgSupabaseStoredGb * SUPABASE_STORAGE_USD_PER_GB * CNY_PER_USD, 4)
  const supabaseTrafficCostPerImage = roundedMetric(avgSupabaseTrafficGb * SUPABASE_TRAFFIC_USD_PER_GB * CNY_PER_USD, 4)
  // Render traffic only applies when images are proxied through backend (no COS public URL)
  const renderTrafficCostPerImage = 0
  const totalCostPerImage = imageSampleSize
    ? roundedMetric(
        (cosStorageCostPerImage * cosImageCount +
         cosTrafficCostPerImage * cosImageCount +
         supabaseStorageCostPerImage * supabaseImageCount +
         supabaseTrafficCostPerImage * supabaseImageCount) / imageSampleSize,
        4,
      )
    : 0

  // Estimate monthly cost based on sample rate
  const sampleDays = RECENT_TRANSACTION_DAYS
  const daysInMonth = 30
  const imagesPerMonth = sampleDays > 0 ? Math.round((imageSampleSize / sampleDays) * daysInMonth) : 0
  const estimatedMonthlyCost = roundedMetric(totalCostPerImage * imagesPerMonth, 2)

  // Legacy score kept for backward compatibility
  const estimatedCostScore = averageLatencySeconds === null
    ? null
    : roundedMetric(averageTrafficMb + averageStoredMb * 0.1 + averageLatencySeconds * 0.02)

  const confidence: AdminImageCostOverview['confidence'] = imageSampleSize >= 50 && attemptSampleSize >= 50
    ? 'high'
    : imageSampleSize >= 10 && attemptSampleSize >= 10
      ? 'medium'
      : imageSampleSize > 0 || attemptSampleSize > 0
        ? 'low'
        : 'none'

  return {
    users,
    codes,
    transactions: {
      last7Days,
      byReason: Array.from(reasonTotals.values()).filter(item => item.count > 0),
    },
    settings: {
      imageCreditCostPerImage: normalizeImageCreditCostPerImage(input.imageCreditCostPerImage ?? DEFAULT_APP_SETTINGS.imageCreditCostPerImage),
    },
    imageCost: {
      sampleDays: RECENT_TRANSACTION_DAYS,
      imageSampleSize,
      attemptSampleSize,
      averageTrafficMb,
      averageStoredMb,
      averageLatencyMs,
      gatewayMemoryMb,
      estimatedMemoryMbSeconds,
      estimatedCostScore,
      confidence,
      cosStorageCostPerImage,
      cosTrafficCostPerImage,
      supabaseStorageCostPerImage,
      supabaseTrafficCostPerImage,
      renderTrafficCostPerImage,
      totalCostPerImage,
      estimatedMonthlyCost,
      cosImageCount,
      supabaseImageCount,
    },
  }
}

async function selectAllAdminRows(
  table: string,
  columns: string,
  apply?: (query: any) => any,
) {
  const client = requireAdminClient()
  const rows: Array<Record<string, unknown>> = []

  for (let from = 0; ; from += OVERVIEW_PAGE_SIZE) {
    let query = client
      .from(table)
      .select(columns)
      .range(from, from + OVERVIEW_PAGE_SIZE - 1)

    if (apply) query = apply(query)

    const { data, error } = await query
    if (error) throw error

    const pageRows = (data || []) as unknown as Array<Record<string, unknown>>
    rows.push(...pageRows)
    if (pageRows.length < OVERVIEW_PAGE_SIZE) break
  }

  return rows
}

export async function isConfiguredAdminUser(user: RequestUser | null) {
  return await isConfiguredAdminUserFromSettings(user)
}

export async function assertAdminUser(user: RequestUser | null) {
  if (!user) throw new AdminCreditError('auth_required')
  const adminAccess = await getAdminAccessSummary()
  if (!adminAccess.configured) {
    throw new AdminCreditError('admin_not_configured')
  }
  if (!await isConfiguredAdminUser(user)) throw new AdminCreditError('admin_forbidden')
  return user
}

export async function listAdminCreditUsers(options: {
  query?: unknown
  limit?: unknown
} = {}) {
  const client = requireAdminClient()
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const limit = sanitizedLimit(options.limit)
  const authUsers = new Map<string, ReturnType<typeof toUserSummary>>()
  const balanceRows = new Map<string, Record<string, unknown>>()
  const requestedIds = new Set<string>()

  const { data: listData, error: listError } = await client.auth.admin.listUsers({
    page: 1,
    perPage: Math.max(limit, 100),
  })
  if (listError) throw listError

  for (const user of listData.users || []) {
    const matchesQuery = user.id.toLowerCase().includes(query) || (user.email || '').toLowerCase().includes(query)
    if (!query || matchesQuery) {
      authUsers.set(user.id, toUserSummary(user))
      if (query) requestedIds.add(user.id)
    }
  }

  if (isUuid(query) && !requestedIds.has(query)) {
    const { data, error } = await client.auth.admin.getUserById(query)
    if (!error && data.user) {
      authUsers.set(data.user.id, toUserSummary(data.user))
      requestedIds.add(data.user.id)
    }
  }

  if (!query) {
    const { data, error } = await client
      .from('user_credit_balances')
      .select('user_id,balance,total_redeemed,total_spent,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    for (const row of data || []) {
      const userId = String(row.user_id || '')
      if (!userId) continue
      balanceRows.set(userId, row as Record<string, unknown>)
      requestedIds.add(userId)
    }
  }

  if (!query && requestedIds.size < limit) {
    for (const user of listData.users || []) {
      requestedIds.add(user.id)
      if (requestedIds.size >= limit) break
    }
  }

  const ids = Array.from(requestedIds).slice(0, limit)
  if (ids.length) {
    const { data, error } = await client
      .from('user_credit_balances')
      .select('user_id,balance,total_redeemed,total_spent,created_at,updated_at')
      .in('user_id', ids)
    if (error) throw error
    for (const row of data || []) {
      const userId = String(row.user_id || '')
      if (userId) balanceRows.set(userId, row as Record<string, unknown>)
    }
  }

  return ids
    .map(userId => toCreditUser(userId, authUsers.get(userId), balanceRows.get(userId)))
    .sort((left, right) => {
      const leftTime = left.updatedAt || left.createdAt || ''
      const rightTime = right.updatedAt || right.createdAt || ''
      return rightTime.localeCompare(leftTime)
    })
}

export async function getAdminCreditOverview() {
  const now = new Date()
  const recentCutoff = new Date(now.getTime() - RECENT_TRANSACTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [settings, balanceRows, codeRows, transactionRows, imageRows, attemptRows] = await Promise.all([
    getAppSettings(),
    selectAllAdminRows('user_credit_balances', 'balance,total_redeemed,total_spent'),
    selectAllAdminRows('credit_redemption_codes', 'credits,max_redemptions,redeemed_count,expires_at,disabled_at'),
    selectAllAdminRows(
      'credit_transactions',
      'amount,reason,created_at',
      query => query.gte('created_at', recentCutoff),
    ),
    selectAllAdminRows(
      'image_generations',
      'original_bytes,preview_bytes,thumbnail_bytes,generated_at,funding_source',
      query => query.gte('generated_at', recentCutoff),
    ),
    selectAllAdminRows(
      'image_generation_attempts',
      'latency_ms,status,created_at',
      query => query.gte('created_at', recentCutoff).eq('status', 'succeeded'),
    ),
  ])

  return {
    ...summarizeAdminCreditOverview({
      balanceRows,
      codeRows,
      transactionRows,
      imageRows,
      attemptRows,
      gatewayMemoryMb: memorySnapshotMb(),
      now,
      imageCreditCostPerImage: settings.imageCreditCostPerImage,
    }),
    generatedAt: now.toISOString(),
  }
}

export async function getAdminCreditUser(userId: string) {
  if (!isUuid(userId)) throw new AdminCreditError('invalid_user_id')
  const users = await listAdminCreditUsers({ query: userId, limit: 1 })
  return users[0] || toCreditUser(userId, undefined, undefined)
}

export async function listAdminCreditTransactions(userId: string, limitValue?: unknown) {
  if (!isUuid(userId)) throw new AdminCreditError('invalid_user_id')
  const client = requireAdminClient()
  const limit = sanitizedLimit(limitValue)
  const { data, error } = await client
    .from('credit_transactions')
    .select('id,user_id,amount,balance_after,reason,redemption_id,related_transaction_id,generation_id,metadata,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function listAdminCreditLedger(options: {
  limit?: unknown
  reason?: unknown
} = {}) {
  const client = requireAdminClient()
  const limit = sanitizedLimit(options.limit)
  const reason = sanitizedReason(options.reason)

  let query = client
    .from('credit_transactions')
    .select('id,user_id,amount,balance_after,reason,redemption_id,related_transaction_id,generation_id,metadata,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (reason) query = query.eq('reason', reason)

  const { data, error } = await query
  if (error) throw error

  const rows = (data || []) as Array<Record<string, unknown>>
  const userIds = Array.from(new Set(
    rows
      .map(row => String(row.user_id || ''))
      .filter(Boolean),
  ))
  const users = await usersById(client, userIds)

  return rows.map(row => toAdminCreditLedgerEntry(row, users.get(String(row.user_id || ''))))
}

export async function listAdminCreditCodes(options: { limit?: unknown } = {}) {
  const client = requireAdminClient()
  const limit = sanitizedLimit(options.limit)
  const { data, error } = await client
    .from('credit_redemption_codes')
    .select('id,credits,max_redemptions,redeemed_count,expires_at,disabled_at,note,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).map(row => toCreditCode(row as Record<string, unknown>))
}

export async function listAdminCreditCodesFiltered(options: {
  limit?: unknown
  status?: unknown
  query?: unknown
} = {}) {
  const client = requireAdminClient()
  const limit = sanitizedLimit(options.limit)
  const status = sanitizedCodeState(options.status)
  const search = sanitizeSearchText(options.query)
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const searchLower = search?.toLowerCase() || ''
  const matches: Array<Record<string, unknown>> = []

  for (let offset = 0; matches.length < limit; offset += CODE_FILTER_PAGE_SIZE) {
    let query = client
      .from('credit_redemption_codes')
      .select('id,credits,max_redemptions,redeemed_count,expires_at,disabled_at,note,created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + CODE_FILTER_PAGE_SIZE - 1)

    if (search) {
      query = query.ilike('note', `%${search}%`)
    }

    if (status === 'disabled') {
      query = query.not('disabled_at', 'is', null)
    } else if (status === 'expired') {
      query = query.is('disabled_at', null).lte('expires_at', nowIso)
    } else if (status === 'active' || status === 'exhausted') {
      query = query
        .is('disabled_at', null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    }

    const { data, error } = await query
    if (error) throw error

    const rows = (data || []) as Array<Record<string, unknown>>
    for (const row of rows) {
      if (status && creditCodeState(row, nowMs) !== status) continue
      if (searchLower) {
        const note = safeDisplayText(row.note, 240)?.toLowerCase() || ''
        if (!note.includes(searchLower)) continue
      }
      matches.push(row)
      if (matches.length >= limit) break
    }

    if (rows.length < CODE_FILTER_PAGE_SIZE) break
  }

  return matches.map(row => toCreditCode(row))
}

export async function listAdminCreditCodeRedemptions(codeId: string, limitValue?: unknown) {
  if (!isUuid(codeId)) throw new AdminCreditError('invalid_code_id')
  const client = requireAdminClient()
  const limit = sanitizedLimit(limitValue)

  const { data: code, error: codeError } = await client
    .from('credit_redemption_codes')
    .select('id')
    .eq('id', codeId)
    .maybeSingle()
  if (codeError) throw codeError
  if (!code) throw new AdminCreditError('invalid_code_id')

  const { data, error } = await client
    .from('credit_redemptions')
    .select('id,code_id,user_id,credits,redeemed_at')
    .eq('code_id', codeId)
    .order('redeemed_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  const rows = (data || []) as Array<Record<string, unknown>>
  const redemptionIds = rows.map(row => String(row.id || '')).filter(Boolean)
  const userIds = Array.from(new Set(rows.map(row => String(row.user_id || '')).filter(Boolean)))
  const users = await usersById(client, userIds)
  const transactions = new Map<string, Record<string, unknown>>()

  if (redemptionIds.length) {
    const { data: transactionRows, error: transactionError } = await client
      .from('credit_transactions')
      .select('id,redemption_id,balance_after')
      .in('redemption_id', redemptionIds)
      .eq('reason', 'redemption')
    if (transactionError) throw transactionError

    for (const row of transactionRows || []) {
      const redemptionId = String((row as Record<string, unknown>).redemption_id || '')
      if (redemptionId && !transactions.has(redemptionId)) {
        transactions.set(redemptionId, row as Record<string, unknown>)
      }
    }
  }

  return rows.map(row => {
    const redemptionId = String(row.id || '')
    return toCreditCodeRedemption(
      row,
      users.get(String(row.user_id || '')),
      transactions.get(redemptionId),
    )
  })
}

export async function createAdminCreditCodes(input: Record<string, unknown>) {
  const client = requireAdminClient()
  const credits = normalizedInteger(input.credits)
  const count = Math.min(100, normalizedInteger(input.count || 1))
  const maxRedemptions = normalizedInteger(input.maxRedemptions ?? input.max_redemptions ?? input.uses ?? 1)
  const expiresAt = expiresAtFromOptions(input.expiresAt ?? input.expires_at, input.days)
  const note = sanitizeText(input.note, 500)
  const prefix = sanitizeText(input.prefix, 48) || 'RECHO'

  if (credits <= 0 || count <= 0 || maxRedemptions <= 0) {
    throw new AdminCreditError('invalid_credit_amount')
  }

  const seen = new Set<string>()
  const generated: Array<{ code: string; codeHash: string }> = []
  while (generated.length < count) {
    const code = createRandomCreditCode(prefix)
    const normalized = normalizeCreditCode(code)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    generated.push({ code, codeHash: creditCodeHash(code) })
  }

  const { data, error } = await client
    .from('credit_redemption_codes')
    .insert(generated.map(code => ({
      code_hash: code.codeHash,
      credits,
      max_redemptions: maxRedemptions,
      expires_at: expiresAt,
      note,
    })))
    .select('id,credits,max_redemptions,redeemed_count,expires_at,disabled_at,note,created_at')

  if (error) throw error
  const rows = (data || []).map(row => toCreditCode(row as Record<string, unknown>))
  return rows.map((row, index): CreatedAdminCreditCode => ({
    ...row,
    code: generated[index]?.code || '',
  }))
}

export async function setAdminCreditCodeDisabled(codeId: string, disabled: boolean) {
  if (!isUuid(codeId)) throw new AdminCreditError('invalid_code_id')
  const client = requireAdminClient()
  const { data, error } = await client
    .from('credit_redemption_codes')
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq('id', codeId)
    .select('id,credits,max_redemptions,redeemed_count,expires_at,disabled_at,note,created_at')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new AdminCreditError('invalid_code_id')
  return toCreditCode(data as Record<string, unknown>)
}

export async function adjustAdminUserCredits(
  userId: string,
  amountValue: unknown,
  adminUser: RequestUser,
  noteValue?: unknown,
) {
  if (!isUuid(userId)) throw new AdminCreditError('invalid_user_id')
  const amount = normalizedSignedInteger(amountValue)
  if (!amount) throw new AdminCreditError('invalid_credit_amount')

  const client = requireAdminClient()
  const { data, error } = await client.rpc('adjust_user_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_admin_user_id: adminUser.id,
    p_note: sanitizeText(noteValue, 500),
    p_metadata: {
      admin_email: adminUser.email,
    },
  })

  if (error) throw new AdminCreditError(adminErrorCode(error))
  const row = Array.isArray(data) ? data[0] : data
  return {
    amount,
    balance: normalizedCreditAmount((row as any)?.balance),
    transactionId: String((row as any)?.transaction_id || ''),
  }
}
