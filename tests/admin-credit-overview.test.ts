import { describe, expect, it } from 'vitest'
import {
  summarizeAdminCreditOverview,
  toAdminCreditLedgerEntry,
} from '../backend/gateway/src/services/admin-credits'

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
      imageRows: [
        { original_bytes: 2_097_152, preview_bytes: 524_288, thumbnail_bytes: 131_072, funding_source: 'free' },
        { original_bytes: 1_048_576, preview_bytes: 262_144, thumbnail_bytes: 65_536, funding_source: 'credit' },
      ],
      attemptRows: [
        { latency_ms: 2000 },
        { latency_ms: 4000 },
      ],
      gatewayMemoryMb: 256,
      imageCreditCostPerImage: 3,
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
    expect(overview.settings).toEqual({
      imageCreditCostPerImage: 3,
    })
    expect(overview.imageCost).toMatchObject({
      sampleDays: 7,
      imageSampleSize: 2,
      attemptSampleSize: 2,
      averageTrafficMb: 0.38,
      averageStoredMb: 1.97,
      averageLatencyMs: 3000,
      gatewayMemoryMb: 256,
      estimatedMemoryMbSeconds: null,
      estimatedCostScore: 0.64,
      confidence: 'low',
    })
  })

  it('does not count baseline gateway RSS as per-image generation cost', () => {
    const overview = summarizeAdminCreditOverview({
      imageRows: [
        { preview_bytes: 1_048_576 },
      ],
      attemptRows: [
        { latency_ms: 30_000 },
      ],
      gatewayMemoryMb: 2_048,
    })

    expect(overview.imageCost).toMatchObject({
      averageTrafficMb: 1,
      averageStoredMb: 1,
      averageLatencyMs: 30_000,
      gatewayMemoryMb: 2_048,
      estimatedMemoryMbSeconds: null,
      estimatedCostScore: 1.7,
    })
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
    expect(overview.imageCost).toMatchObject({
      imageSampleSize: 0,
      attemptSampleSize: 0,
      averageTrafficMb: 0,
      averageStoredMb: 0,
      averageLatencyMs: null,
      estimatedMemoryMbSeconds: null,
      estimatedCostScore: null,
      confidence: 'none',
    })
  })

  it('preserves decimal credit balances, costs, and ledger amounts', () => {
    const overview = summarizeAdminCreditOverview({
      now: new Date('2026-06-08T12:00:00.000Z'),
      balanceRows: [
        { balance: 12.25, total_redeemed: 40.5, total_spent: 28.25 },
      ],
      transactionRows: [
        { amount: -0.25, reason: 'image_generation', created_at: '2026-06-08T11:00:00.000Z' },
      ],
      imageCreditCostPerImage: 0.25,
    })

    expect(overview.users).toMatchObject({
      totalBalance: 12.25,
      totalRedeemed: 40.5,
      totalSpent: 28.25,
    })
    expect(overview.transactions.last7Days.spentCredits).toBe(0.25)
    expect(overview.settings.imageCreditCostPerImage).toBe(0.25)

    const entry = toAdminCreditLedgerEntry({
      id: 'tx_decimal',
      user_id: 'user_1',
      amount: -0.25,
      balance_after: 12.25,
      reason: 'image_generation',
      metadata: {
        creditCostPerImage: 0.25,
        creditCost: 0.5,
      },
    })

    expect(entry.amount).toBe(-0.25)
    expect(entry.balanceAfter).toBe(12.25)
    expect(entry.details.creditCostPerImage).toBe(0.25)
    expect(entry.details.creditCost).toBe(0.5)
  })

  it('returns a redacted whitelist view for ledger metadata', () => {
    const entry = toAdminCreditLedgerEntry({
      id: 'tx_1',
      user_id: 'user_1',
      amount: -6,
      balance_after: 10,
      reason: 'image_generation',
      generation_id: 'generation_123456789',
      metadata: {
        count: 2,
        creditCostPerImage: 3,
        creditCost: 6,
        quality: 'high',
        resolution: '2k',
        size: '2048x2048',
        aspectRatio: '1:1',
        referenceCount: 1,
        reason: 'https://secret.example.com/refund',
        note: 'token=abc123 api_key=sk-this-secret-should-not-leak-1234567890',
        rawPrompt: 'do not expose this prompt',
      },
      created_at: '2026-06-08T12:00:00.000Z',
    })

    expect(entry.details).toMatchObject({
      count: 2,
      creditCostPerImage: 3,
      creditCost: 6,
      quality: 'high',
      resolution: '2k',
      size: '2048x2048',
      aspectRatio: '1:1',
      referenceCount: 1,
      refundReason: '[redacted-url]',
    })
    expect(entry.note).toContain('[redacted-secret]')
    expect(JSON.stringify(entry)).not.toContain('rawPrompt')
    expect(JSON.stringify(entry)).not.toContain('secret.example.com')
    expect(JSON.stringify(entry)).not.toContain('sk-this-secret')
  })
})
