import { getSupabaseAdminClient } from '../clients/supabase.js'
import { creditCodeHash } from './credit-code.js'
import { roundCreditAmount } from './image-credit-cost.js'
import { CreditError, CreditServiceUnavailableError, extractCreditErrorCode } from './credit-error.js'

const CREDIT_BALANCES_TABLE = 'user_credit_balances'

export interface CreditBalance {
  balance: number | null
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

// Re-export for backward compatibility
export { CreditError, CreditServiceUnavailableError, extractCreditErrorCode }

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
  const rounded = roundCreditAmount(value)
  return rounded === null ? 0 : Math.max(0, rounded)
}

function rpcRow<T>(data: T[] | T | null) {
  return Array.isArray(data) ? data[0] : data
}

export async function getUserCreditBalance(userId: string): Promise<CreditBalance> {
  if (!userId) throw new CreditError('auth_required')
  const client = requireCreditClient()

  const { data, error } = await client
    .from(CREDIT_BALANCES_TABLE)
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { balance: null }
  return { balance: normalizedCreditAmount((data as { balance?: unknown }).balance) }
}

export async function redeemCreditCode(userId: string, rawCode: unknown): Promise<CreditRedemptionResult> {
  if (!userId) throw new CreditError('auth_required')
  const hash = creditCodeHash(rawCode)
  if (!hash) throw new CreditError('invalid_code')

  const client = requireCreditClient()
  const { data, error } = await client.rpc('redeem_credit_code', {
    p_user_id: userId,
    p_code_hash: hash,
  })

  if (error) throw new CreditError(extractCreditErrorCode(error))
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
  if (!userId) throw new CreditError('auth_required')
  const creditAmount = roundCreditAmount(amount)
  if (creditAmount <= 0) throw new CreditError('invalid_credit_amount')

  const client = requireCreditClient()
  const { data, error } = await client.rpc('reserve_user_credits', {
    p_user_id: userId,
    p_amount: creditAmount,
    p_metadata: metadata,
  })

  if (error) {
    const record = typeof error === 'object' && error !== null ? (error as unknown as Record<string, unknown>) : {}
    console.error('[credits] reserve_user_credits RPC failed:', {
      message: record.message,
      details: record.details,
      hint: record.hint,
      code: record.code,
      error,
    })
    throw new CreditError(extractCreditErrorCode(error))
  }
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
  if (!userId) throw new CreditError('auth_required')
  const creditAmount = roundCreditAmount(amount)
  if (creditAmount <= 0) throw new CreditError('invalid_credit_amount')

  const client = requireCreditClient()
  const { data, error } = await client.rpc('refund_user_credits', {
    p_user_id: userId,
    p_amount: creditAmount,
    p_related_transaction_id: relatedTransactionId || null,
    p_metadata: metadata,
  })

  if (error) throw new CreditError(extractCreditErrorCode(error))
  const row = rpcRow(data as Array<{ balance?: unknown }> | null)
  return {
    amount: creditAmount,
    balance: normalizedCreditAmount(row?.balance),
  }
}
