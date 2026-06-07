import { describe, expect, it } from 'vitest'
import { summarizeAdminCreditOverview } from '../backend/gateway/src/services/admin-credits'

describe('admin credit overview helpers', () => {
  it('summarizes balances, code states, and recent ledger totals', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const overview = summarizeAdminCreditOverview({
      now,
      balanceRows: [
        { balance: 12, total_redeemed: 40, total_spent: 28 },
        { balance: 5, total_redeemed: 10, total_spent: 5 },
      ],
      codeRows: [
        { credits: 100, max_redemptions: 2, redeemed_count: 1 },
        { credits: 50, max_redemptions: 1, redeemed_count: 0, disabled_at: '2026-06-08T00:00:00.000Z' },
        { credits: 25, max_redemptions: 1, redeemed_count: 0, expires_at: '2026-06-01T00:00:00.000Z' },
        { credits: 10, max_redemptions: 3, redeemed_count: 3 },
      ],
      transactionRows: [
        { amount: 100, reason: 'redemption', created_at: '2026-06-07T12:00:00.000Z' },
        { amount: -2, reason: 'image_generation', created_at: '2026-06-07T13:00:00.000Z' },
        { amount: 1, reason: 'refund', created_at: '2026-06-07T14:00:00.000Z' },
        { amount: -5, reason: 'admin_adjustment', created_at: '2026-06-07T15:00:00.000Z' },
        { amount: 30, reason: 'redemption', created_at: '2026-05-01T00:00:00.000Z' },
      ],
    })

    expect(overview.users).toEqual({
      withCreditRows: 2,
      totalBalance: 17,
      totalRedeemed: 50,
      totalSpent: 33,
    })
    expect(overview.codes).toEqual({
      total: 4,
      active: 1,
      disabled: 1,
      expired: 1,
      exhausted: 1,
      totalIssuedCredits: 305,
      totalRedeemedCredits: 130,
    })
    expect(overview.transactions.last7Days).toEqual({
      totalCount: 4,
      redeemedCredits: 100,
      spentCredits: 2,
      refundedCredits: 1,
      adminAdjustedCredits: -5,
    })
    expect(overview.transactions.byReason).toEqual([
      { reason: 'redemption', count: 1, amount: 100 },
      { reason: 'image_generation', count: 1, amount: -2 },
      { reason: 'refund', count: 1, amount: 1 },
      { reason: 'admin_adjustment', count: 1, amount: -5 },
    ])
  })

  it('treats empty or malformed rows as zero-safe data', () => {
    const overview = summarizeAdminCreditOverview({
      now: new Date('2026-06-08T12:00:00.000Z'),
      balanceRows: [{ balance: 'bad', total_redeemed: null, total_spent: undefined }],
      codeRows: [{ credits: 'bad', max_redemptions: 0, redeemed_count: 2 }],
      transactionRows: [{ amount: 'bad', reason: 'redemption', created_at: 'not-a-date' }],
    })

    expect(overview.users.totalBalance).toBe(0)
    expect(overview.codes.totalIssuedCredits).toBe(0)
    expect(overview.codes.exhausted).toBe(1)
    expect(overview.transactions.last7Days.totalCount).toBe(0)
  })
})
