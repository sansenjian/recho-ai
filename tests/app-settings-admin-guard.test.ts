import { beforeEach, describe, expect, it, vi } from 'vitest'

let adminUserRows: Array<Record<string, unknown>> = []
const updateMock = vi.fn()

vi.mock('../backend/gateway/src/config', () => ({
  ADMIN_USER_EMAILS: [],
  ADMIN_USER_IDS: [],
  CANVAS_CONTEXT_ENABLED: false,
  IMAGE_ANALYTICS_ENABLED: false,
  IMAGE_CREDIT_COST_PER_IMAGE: 1,
  IMAGE_EVENTS_ENABLED: false,
  IMAGE_GEN_API_KEY: '',
  IMAGE_GEN_BASE_URL: 'https://image.example.test/v1',
  IMAGE_RESPONSES_IMAGE_MODEL: 'gpt-image-2',
  IMAGE_RESPONSES_MODEL: 'gpt-image-2',
  KIMI_API_KEY: '',
  KIMI_BASE_URL: '',
  NVIDIA_API_KEY: '',
  NVIDIA_BASE_URL: '',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: '',
  SUPABASE_PUBLISHABLE_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_URL: '',
  TENCENT_COS_APPID: '',
  TENCENT_COS_BUCKET: '',
  TENCENT_COS_FULL_BUCKET: '',
  TENCENT_COS_PUBLIC_BASE_URL: '',
  TENCENT_COS_SECRET_ID: '',
  TENCENT_COS_SECRET_KEY: '',
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'admin_users') {
        return {
          select: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: adminUserRows,
              error: null,
            })),
          })),
          update: updateMock,
        }
      }

      return {
        select: vi.fn(async () => ({
          data: [],
          error: null,
        })),
      }
    },
  }),
}))

describe('app settings admin guardrails', () => {
  beforeEach(() => {
    adminUserRows = []
    updateMock.mockReset()
    vi.resetModules()
  })

  it('does not disable the last available database admin rule', async () => {
    const { updateAdminUserRule } = await import('../backend/gateway/src/services/app-settings')
    adminUserRows = [{
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      email: null,
      enabled: true,
      note: null,
    }]

    await expect(updateAdminUserRule(
      '11111111-1111-4111-8111-111111111111',
      { enabled: false },
      { id: '22222222-2222-4222-8222-222222222222', email: null },
    )).rejects.toMatchObject({
      message: 'last_admin_rule',
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('maps database last-admin trigger failures to a safe app error', async () => {
    const { updateAdminUserRule } = await import('../backend/gateway/src/services/app-settings')
    adminUserRows = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '22222222-2222-4222-8222-222222222222',
        email: null,
        enabled: true,
        note: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        user_id: '44444444-4444-4444-8444-444444444444',
        email: null,
        enabled: true,
        note: null,
      },
    ]
    updateMock.mockReturnValue({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: null,
            error: { code: 'P0001', message: 'last_admin_rule' },
          })),
        })),
      })),
    })

    await expect(updateAdminUserRule(
      '11111111-1111-4111-8111-111111111111',
      { enabled: false },
      { id: '22222222-2222-4222-8222-222222222222', email: null },
    )).rejects.toMatchObject({
      message: 'last_admin_rule',
      publicMessage: '至少保留一个可用的后台管理员。',
    })
    expect(updateMock).toHaveBeenCalled()
  })
})
