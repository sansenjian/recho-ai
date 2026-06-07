import { beforeEach, describe, expect, it, vi } from 'vitest'

let rows: Array<Record<string, unknown>> = []
let statusFilter: unknown = null
let limitValue: unknown = null

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
    from: () => {
      const query = {
        select: vi.fn(() => query),
        gte: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn((value: unknown) => {
          limitValue = value
          return Promise.resolve({ data: rows, error: null })
        }),
        eq: vi.fn((_key: string, value: unknown) => {
          statusFilter = value
          rows = rows.filter(row => row.status === value)
          return query
        }),
      }
      return query
    },
  }),
}))

describe('admin image attempt helpers', () => {
  beforeEach(() => {
    rows = []
    statusFilter = null
    limitValue = null
    vi.resetModules()
  })

  it('summarizes attempts and returns redacted recent rows', async () => {
    const { listAdminImageAttempts } = await import('../backend/gateway/src/services/admin-image-attempts')
    rows = [
      {
        id: 'attempt_1',
        generation_id: 'img_1',
        user_id: 'user_1',
        status: 'failed',
        latency_ms: 2000,
        error_type: 'provider',
        error_code: 'upstream_error',
        error_message: 'Failed calling https://secret.example.test/v1 with api_key=sk-secret-value-that-should-not-leak-123456',
        http_status: 502,
        created_at: '2026-06-08T12:00:00.000Z',
        request_ip: '127.0.0.1',
        provider: 'secret.example.test',
      },
      {
        id: 'attempt_2',
        generation_id: 'img_2',
        user_id: 'user_2',
        status: 'succeeded',
        latency_ms: 1000,
        created_at: '2026-06-08T12:01:00.000Z',
      },
      {
        id: 'attempt_3',
        generation_id: null,
        user_id: 'user_1',
        status: 'failed',
        latency_ms: 4000,
        error_type: 'timeout',
        http_status: 524,
        created_at: '2026-06-08T12:02:00.000Z',
      },
    ]

    const result = await listAdminImageAttempts({ limit: 2 })

    expect(limitValue).toBe(500)
    expect(result.overview).toMatchObject({
      total: 3,
      succeeded: 1,
      failed: 2,
      failureRate: 66.7,
      averageLatencyMs: 2333,
      byErrorType: [
        { errorType: 'provider', count: 1 },
        { errorType: 'timeout', count: 1 },
      ],
    })
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0]).toMatchObject({
      id: 'attempt_1',
      email: 'user_1@example.test',
      status: 'failed',
      latencyMs: 2000,
      httpStatus: 502,
    })
    expect(result.attempts[0].errorMessage).toContain('[redacted-url]')
    expect(result.attempts[0].errorMessage).toContain('[redacted-secret]')
    expect(JSON.stringify(result)).not.toContain('127.0.0.1')
    expect(JSON.stringify(result)).not.toContain('secret.example.test/v1')
    expect(JSON.stringify(result)).not.toContain('sk-secret')
  })

  it('applies a valid status filter', async () => {
    const { listAdminImageAttempts } = await import('../backend/gateway/src/services/admin-image-attempts')
    rows = [
      { id: 'attempt_1', status: 'failed', created_at: '2026-06-08T12:00:00.000Z' },
      { id: 'attempt_2', status: 'succeeded', created_at: '2026-06-08T12:01:00.000Z' },
    ]

    const result = await listAdminImageAttempts({ status: 'failed' })

    expect(statusFilter).toBe('failed')
    expect(result.overview.total).toBe(1)
    expect(result.attempts[0].status).toBe('failed')
  })

  it('ignores malformed status filters', async () => {
    const { listAdminImageAttempts } = await import('../backend/gateway/src/services/admin-image-attempts')
    rows = [{ id: 'attempt_1', status: 'succeeded', created_at: '2026-06-08T12:00:00.000Z' }]

    const result = await listAdminImageAttempts({ status: 'all' })

    expect(statusFilter).toBeNull()
    expect(result.overview.total).toBe(1)
  })
})
