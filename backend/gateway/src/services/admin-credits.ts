import type { User } from '@supabase/supabase-js'
import { ADMIN_USER_EMAILS, ADMIN_USER_IDS } from '../config.js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { createRandomCreditCode, creditCodeHash, normalizeCreditCode } from './credit-code.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const OVERVIEW_PAGE_SIZE = 1000
const RECENT_TRANSACTION_DAYS = 7
const CREDIT_TRANSACTION_REASONS = ['redemption', 'image_generation', 'refund', 'admin_adjustment'] as const

export interface RequestUser {
  id: string
  email: string | null
}

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
  generatedAt: string
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

function normalizedCodeUses(value: unknown) {
  const number = normalizedInteger(value)
  return number > 0 ? number : 1
}

function sanitizedLimit(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(number)))
}

function sanitizeText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
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
    balance: normalizedInteger(balance?.balance),
    totalRedeemed: normalizedInteger(balance?.total_redeemed),
    totalSpent: normalizedInteger(balance?.total_spent),
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
    note: typeof row.note === 'string' ? row.note : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  }
}

function creditCodeState(row: Record<string, unknown>, nowMs: number) {
  if (row.disabled_at) return 'disabled'
  if (typeof row.expires_at === 'string' && new Date(row.expires_at).getTime() <= nowMs) return 'expired'

  const maxRedemptions = normalizedCodeUses(row.max_redemptions)
  if (normalizedInteger(row.redeemed_count) >= maxRedemptions) return 'exhausted'

  return 'active'
}

export function summarizeAdminCreditOverview(input: {
  balanceRows?: Array<Record<string, unknown>>
  codeRows?: Array<Record<string, unknown>>
  transactionRows?: Array<Record<string, unknown>>
  now?: Date
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
    users.totalBalance += normalizedInteger(row.balance)
    users.totalRedeemed += normalizedInteger(row.total_redeemed)
    users.totalSpent += normalizedInteger(row.total_spent)
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
    const amount = normalizedSignedInteger(row.amount)
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

  return {
    users,
    codes,
    transactions: {
      last7Days,
      byReason: Array.from(reasonTotals.values()).filter(item => item.count > 0),
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

export function isConfiguredAdminUser(user: RequestUser | null) {
  if (!user) return false
  if (!ADMIN_USER_IDS.length && !ADMIN_USER_EMAILS.length) return false
  if (ADMIN_USER_IDS.includes(user.id)) return true
  return Boolean(user.email && ADMIN_USER_EMAILS.includes(user.email.toLowerCase()))
}

export function assertAdminUser(user: RequestUser | null) {
  if (!user) throw new AdminCreditError('auth_required')
  if (!ADMIN_USER_IDS.length && !ADMIN_USER_EMAILS.length) {
    throw new AdminCreditError('admin_not_configured')
  }
  if (!isConfiguredAdminUser(user)) throw new AdminCreditError('admin_forbidden')
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
  const [balanceRows, codeRows, transactionRows] = await Promise.all([
    selectAllAdminRows('user_credit_balances', 'balance,total_redeemed,total_spent'),
    selectAllAdminRows('credit_redemption_codes', 'credits,max_redemptions,redeemed_count,expires_at,disabled_at'),
    selectAllAdminRows(
      'credit_transactions',
      'amount,reason,created_at',
      query => query.gte('created_at', recentCutoff),
    ),
  ])

  return {
    ...summarizeAdminCreditOverview({
      balanceRows,
      codeRows,
      transactionRows,
      now,
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
    balance: normalizedInteger((row as any)?.balance),
    transactionId: String((row as any)?.transaction_id || ''),
  }
}
