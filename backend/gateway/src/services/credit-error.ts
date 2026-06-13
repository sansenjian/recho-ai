/**
 * Unified CreditError base class with centralized code → status → message mapping.
 * All credit-related errors should extend this class or use CREDIT_ERROR_CODES.
 */

export const CREDIT_ERROR_CODES = {
  auth_required: { status: 401, message: '请先登录后再使用额度。' },
  insufficient_credits: { status: 402, message: '额度不足，本次将按公开作品生成。' },
  invalid_code: { status: 400, message: '兑换码无效，请检查后重试。' },
  code_already_redeemed: { status: 409, message: '这个兑换码已经兑换过。' },
  code_expired: { status: 400, message: '这个兑换码已过期。' },
  code_disabled: { status: 400, message: '这个兑换码已停用。' },
  code_exhausted: { status: 400, message: '这个兑换码已被用完。' },
  invalid_credit_amount: { status: 400, message: '额度数量无效。' },
  service_unavailable: { status: 503, message: '额度服务暂时不可用，本次将按公开作品生成。' },
  credit_operation_failed: { status: 500, message: '额度操作失败，请稍后重试。' },
} as const

export type CreditErrorCode = keyof typeof CREDIT_ERROR_CODES

export class CreditError extends Error {
  readonly code: CreditErrorCode
  readonly status: number
  readonly publicMessage: string

  constructor(code: CreditErrorCode, overrides?: { status?: number; publicMessage?: string }) {
    super(code)
    this.name = 'CreditError'
    this.code = code
    const defaults = CREDIT_ERROR_CODES[code] ?? CREDIT_ERROR_CODES['credit_operation_failed']
    this.status = overrides?.status ?? defaults.status
    this.publicMessage = overrides?.publicMessage ?? defaults.message
  }
}

export class CreditServiceUnavailableError extends CreditError {
  constructor() {
    super('service_unavailable')
  }
}

/** Codes that allow falling back to public (non-credit) generation */
export const PUBLIC_FALLBACK_CREDIT_CODES = new Set([
  'insufficient_credits',
  'credit_operation_failed',
  'service_unavailable',
] as const)

export function isPublicFallbackCreditError(err: unknown): err is CreditError {
  if (!(err instanceof CreditError)) return false
  return (PUBLIC_FALLBACK_CREDIT_CODES as ReadonlySet<CreditErrorCode>).has(err.code)
}

/** Extract credit error code from raw error message (e.g. from Supabase RPC) */
export function extractCreditErrorCode(error: unknown): CreditErrorCode {
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
  return (match?.[1] as CreditErrorCode) || 'credit_operation_failed'
}
