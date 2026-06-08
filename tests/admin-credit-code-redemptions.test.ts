import { beforeEach, describe, expect, it, vi } from 'vitest'

const codeId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const redemptionId = '33333333-3333-4333-8333-333333333333'

let codeRow: Record<string, unknown> | null = { id: codeId, code_hash: 'secret-hash' }
let redemptionRows: Array<Record<string, unknown>> = []
let transactionRows: Array<Record<string, unknown>> = []
let limitValue: unknown = null
let transactionRedemptionIds: unknown = null

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: { user: { id, email: `${id}@example.test` } },
          error: null,
        })),
      },
    },
    from: (table: string) => {
      if (table === 'credit_redemption_codes') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(async () => ({ data: codeRow, error: null })),
        }
        return query
      }

      if (table === 'credit_redemptions') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(async (value: unknown) => {
            limitValue = value
            return { data: redemptionRows, error: null }
          }),
        }
        return query
      }

      if (table === 'credit_transactions') {
        const query = {
          select: vi.fn(() => query),
          in: vi.fn((_key: string, value: unknown) => {
            transactionRedemptionIds = value
            return query
          }),
          eq: vi.fn(async () => ({ data: transactionRows, error: null })),
        }
        return query
      }

      throw new Error(`Unexpected table ${table}`)
    },
  }),
}))

describe('admin credit code redemptions', () => {
  beforeEach(() => {
    codeRow = { id: codeId, code_hash: 'secret-hash', raw_code: 'RECHO-SECRET' }
    redemptionRows = []
    transactionRows = []
    limitValue = null
    transactionRedemptionIds = null
    vi.resetModules()
  })

  it('lists redemption details with user and ledger context', async () => {
    const { listAdminCreditCodeRedemptions } = await import('../backend/gateway/src/services/admin-credits')
    redemptionRows = [
      {
        id: redemptionId,
        code_id: codeId,
        user_id: userId,
        credits: 100,
        redeemed_at: '2026-06-08T10:00:00.000Z',
        code_hash: 'secret-hash',
      },
    ]
    transactionRows = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        redemption_id: redemptionId,
        balance_after: 120,
        metadata: { raw_code: 'RECHO-SECRET' },
      },
    ]

    const redemptions = await listAdminCreditCodeRedemptions(codeId, 10)

    expect(limitValue).toBe(10)
    expect(transactionRedemptionIds).toEqual([redemptionId])
    expect(redemptions).toEqual([
      {
        id: redemptionId,
        userId,
        email: `${userId}@example.test`,
        credits: 100,
        redeemedAt: '2026-06-08T10:00:00.000Z',
        transactionId: '44444444-4444-4444-8444-444444444444',
        balanceAfter: 120,
      },
    ])
    expect(JSON.stringify(redemptions)).not.toContain('secret-hash')
    expect(JSON.stringify(redemptions)).not.toContain('RECHO-SECRET')
  })

  it('rejects missing codes', async () => {
    const { listAdminCreditCodeRedemptions } = await import('../backend/gateway/src/services/admin-credits')
    codeRow = null

    await expect(listAdminCreditCodeRedemptions(codeId)).rejects.toMatchObject({
      message: 'invalid_code_id',
    })
  })
})
