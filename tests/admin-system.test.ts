import { beforeEach, describe, expect, it, vi } from 'vitest'

let tableCounts: Record<string, number> = {}
let tableErrors: Record<string, unknown> = {}

vi.mock('../backend/gateway/src/config', () => ({
  ADMIN_USER_EMAILS: ['admin@example.test'],
  ADMIN_USER_IDS: ['admin-user-id'],
  IMAGE_ANALYTICS_ENABLED: true,
  IMAGE_CREDIT_COST_PER_IMAGE: 3,
  IMAGE_GEN_API_KEY: 'sk-secret-image-key-that-must-not-leak',
  SUPABASE_IMAGE_BUCKET: 'secret-bucket-name',
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  hasSupabaseAdminConfig: () => true,
  hasSupabaseConfig: () => true,
  getSupabaseAdminClient: () => ({
    from: (table: string) => ({
      select: vi.fn(async () => ({
        count: tableCounts[table] ?? 0,
        error: tableErrors[table] ?? null,
      })),
    }),
  }),
}))

describe('admin system status helpers', () => {
  beforeEach(() => {
    tableCounts = {}
    tableErrors = {}
    vi.resetModules()
  })

  it('summarizes healthy config and table checks without exposing raw settings', async () => {
    const { getAdminSystemStatus } = await import('../backend/gateway/src/services/admin-system')
    tableCounts = {
      user_credit_balances: 2,
      credit_redemption_codes: 3,
      credit_transactions: 4,
      image_generations: 5,
      image_generation_attempts: 6,
      image_generation_contexts: 7,
      image_events: 8,
    }

    const status = await getAdminSystemStatus()

    expect(status.status).toBe('ok')
    expect(status.config).toMatchObject({
      supabase: {
        publicConfigured: true,
        adminConfigured: true,
        imageBucketConfigured: true,
      },
      imageGeneration: {
        apiKeyConfigured: true,
        creditCostPerImage: 3,
        analyticsEnabled: true,
      },
      adminUsers: {
        configured: true,
        userIdCount: 1,
        emailCount: 1,
      },
    })
    expect(status.data.tables).toHaveLength(7)
    expect(status.data.tables.every(table => table.status === 'ok')).toBe(true)
    expect(status.warnings).toEqual([])

    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('sk-secret')
    expect(serialized).not.toContain('secret-bucket-name')
    expect(serialized).not.toContain('admin@example.test')
    expect(serialized).not.toContain('admin-user-id')
  })

  it('reports sanitized table failures as warnings', async () => {
    const { getAdminSystemStatus } = await import('../backend/gateway/src/services/admin-system')
    tableErrors = {
      image_generations: {
        code: '42P01',
        message: 'relation "public.image_generations" does not exist at https://secret-project.supabase.co/rest/v1',
      },
      image_generation_attempts: {
        code: '42501',
        message: 'permission denied for table with service_role=secret',
      },
    }

    const status = await getAdminSystemStatus()

    expect(status.status).toBe('warning')
    expect(status.data.tables.find(table => table.key === 'imageGenerations')).toMatchObject({
      status: 'missing',
      message: '数据表不存在',
      count: null,
    })
    expect(status.data.tables.find(table => table.key === 'imageAttempts')).toMatchObject({
      status: 'restricted',
      message: '权限不足',
      count: null,
    })
    expect(status.warnings).toContain('2 个后台数据表不可读')
    expect(JSON.stringify(status)).not.toContain('secret-project.supabase.co')
    expect(JSON.stringify(status)).not.toContain('service_role=secret')
  })

  it('marks blocking config gaps as errors', async () => {
    const { summarizeAdminSystemStatus } = await import('../backend/gateway/src/services/admin-system')

    const status = summarizeAdminSystemStatus({
      tables: [],
      supabasePublicConfigured: true,
      supabaseAdminConfigured: false,
      supabaseImageBucketConfigured: true,
      imageApiKeyConfigured: false,
      adminUserIdCount: 0,
      adminEmailCount: 0,
    })

    expect(status.status).toBe('error')
    expect(status.warnings).toEqual([
      'Supabase 后端权限未就绪',
      '生图服务 key 未配置',
      '后台管理员未配置',
    ])
  })
})
