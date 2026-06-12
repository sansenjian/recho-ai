import { getSupabaseAdminClient } from '../clients/supabase.js'
import { creditCodeHash } from './credit-code.js'
import { roundCreditAmount } from './image-credit-cost.js'

const CREDIT_BALANCES_TABLE = 'user_credit_balances'

export interface CreditBalance {
  balance: number
}

export interface CreditRedemptionResult extends CreditBalance {
  redeemedCredits: number
}

export interface CreditReservation extends CreditBalance {
  amount: number
  transactionId: string
}

export interface CreditRefund extends CreditBalance {
  amount: number
}

export class CreditServiceUnavailableError extends Error {
  status = 503
  publicMessage = '额度服务暂时不可用，请稍后重试。'

  constructor() {
    super('credit service unavailable')
  }
}

export class CreditOperationError extends Error {
  code: string
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.code = code
    this.status = options.status ?? statusForCreditError(code)
    this.publicMessage = options.publicMessage ?? publicMessageForCreditError(code)
  }
}

function statusForCreditError(code: string) {
  if (code === 'auth_required') return 401
  if (code === 'insufficient_credits') return 402
  if (code === 'code_already_redeemed') return 409
  if (code === 'credit_operation_failed') return 500
  return 400
}

function publicMessageForCreditError(code: string) {
  if (code === 'auth_required') return '请先登录后再使用额度。'
  if (code === 'insufficient_credits') return '额度不足，本次将按公开作品生成。'
  if (code === 'invalid_code') return '兑换码无效，请检查后重试。'
  if (code === 'code_already_redeemed') return '这个兑换码已经兑换过。'
  if (code === 'code_expired') return '这个兑换码已过期。'
  if (code === 'code_disabled') return '这个兑换码已停用。'
  if (code === 'code_exhausted') return '这个兑换码已被用完。'
  if (code === 'invalid_credit_amount') return '额度数量无效。'
  return '额度操作失败，请稍后重试。'
}

function creditErrorCode(error: unknown) {
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
  const match = /\b(auth_required|insufficient_credits|invalid_code|code_disabled|code_expired|code_already_redeemed|code_exhausted|invalid_credit_amount)\b/.exec(message)
  return match?.[1] || 'credit_operation_failed'
}

function requireCreditClient() {
  const client = getSupabaseAdminClient()
  if (!client) throw new CreditServiceUnavailableError()
  return client
}

function normalizedInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function normalizedCreditAmount(value: unknown) {
  return Math.max(0, roundCreditAmount(value))
}

function rpcRow<T>(data: T[] | T | null) {
  return Array.isArray(data) ? data[0] : data
}

export async function getUserCreditBalance(userId: string): Promise<CreditBalance> {
  if (!userId) throw new CreditOperationError('auth_required')
  const client = requireCreditClient()

  const { data, error } = await client
    .from(CREDIT_BALANCES_TABLE)
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return { balance: normalizedCreditAmount((data as { balance?: unknown } | null)?.balance) }
}

export async function redeemCreditCode(userId: string, rawCode: unknown): Promise<CreditRedemptionResult> {
  if (!userId) throw new CreditOperationError('auth_required')
  const hash = creditCodeHash(rawCode)
  if (!hash) throw new CreditOperationError('invalid_code')

  const client = requireCreditClient()
  const { data, error } = await client.rpc('redeem_credit_code', {
    p_user_id: userId,
    p_code_hash: hash,
  })

  if (error) throw new CreditOperationError(creditErrorCode(error))
  const row = rpcRow(data as Array<{ balance?: unknown; credits?: unknown }> | null)
  return {
    balance: normalizedCreditAmount(row?.balance),
    redeemedCredits: normalizedInteger(row?.credits),
  }
}

export async function reserveUserCredits(
  userId: string,
  amount: number,
  metadata: Record<string, unknown> = {},
): Promise<CreditReservation> {
  if (!userId) throw new CreditOperationError('auth_required')
  const creditAmount = roundCreditAmount(amount)
  if (creditAmount <= 0) throw new CreditOperationError('invalid_credit_amount')

  const client = requireCreditClient()
  const { data, error } = await client.rpc('reserve_user_credits', {
    p_user_id: userId,
    p_amount: creditAmount,
    p_metadata: metadata,
  })

  if (error) throw new CreditOperationError(creditErrorCode(error))
  const row = rpcRow(data as Array<{ balance?: unknown; transaction_id?: unknown }> | null)
  const transactionId = typeof row?.transaction_id === 'string' ? row.transaction_id : ''
  if (!transactionId) throw new Error('credit transaction was not created')

  return {
    amount: creditAmount,
    balance: normalizedCreditAmount(row?.balance),
    transactionId,
  }
}

export async function refundUserCredits(
  userId: string,
  amount: number,
  relatedTransactionId?: string | null,
  metadata: Record<string, unknown> = {},
): Promise<CreditRefund> {
  if (!userId) throw new CreditOperationError('auth_required')
  const creditAmount = roundCreditAmount(amount)
  if (creditAmount <= 0) throw new CreditOperationError('invalid_credit_amount')

  const client = requireCreditClient()
  const { data, error } = await client.rpc('refund_user_credits', {
    p_user_id: userId,
    p_amount: creditAmount,
    p_related_transaction_id: relatedTransactionId || null,
    p_metadata: metadata,
  })

  if (error) throw new CreditOperationError(creditErrorCode(error))
  const row = rpcRow(data as Array<{ balance?: unknown }> | null)
  return {
    amount: creditAmount,
    balance: normalizedCreditAmount(row?.balance),
  }
}
