import { beforeEach, describe, expect, it, vi } from 'vitest'

let appSettingRows: Array<Record<string, unknown>> = []
let adminUserRows: Array<Record<string, unknown>> = []
let appSettingsError: unknown = null
let appSettingsSelectCount = 0

vi.mock('../backend/gateway/src/config', () => ({
  ADMIN_USER_EMAILS: ['env-admin@example.test'],
  ADMIN_USER_IDS: ['env-admin-id'],
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
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'app_settings') {
        return {
          select: vi.fn(async () => {
            appSettingsSelectCount += 1
            return {
              data: appSettingRows,
              error: appSettingsError,
            }
          }),
          upsert: vi.fn(async () => ({ error: null })),
        }
      }

      if (table === 'admin_users') {
        return {
          select: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: adminUserRows,
              error: null,
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: adminUserRows[0] || null, error: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: adminUserRows[0] || null, error: null })),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    },
  }),
}))

describe('app settings service', () => {
  beforeEach(() => {
    appSettingRows = []
    adminUserRows = []
    appSettingsError = null
    appSettingsSelectCount = 0
    vi.resetModules()
  })

  it('loads image settings from Supabase rows and exposes only public switches', async () => {
    appSettingRows = [
      { key: 'image_credit_cost_per_image', value: 4 },
      { key: 'image_analytics_enabled', value: true },
      { key: 'image_responses_model', value: 'gpt-image-2' },
      { key: 'image_responses_image_model', value: 'custom-image-model' },
      { key: 'image_events_enabled', value: true },
      { key: 'canvas_context_enabled', value: true },
    ]
    const { getAppSettings, publicAppConfig } = await import('../backend/gateway/src/services/app-settings')

    await expect(getAppSettings({ refresh: true })).resolves.toMatchObject({
      imageCreditCostPerImage: 4,
      imageAnalyticsEnabled: true,
      imageResponsesModel: 'gpt-image-2',
      imageResponsesImageModel: 'custom-image-model',
      imageEventsEnabled: true,
      canvasContextEnabled: true,
    })

    const publicConfig = await publicAppConfig()
    expect(publicConfig).toEqual({
      imageEventsEnabled: true,
      canvasContextEnabled: true,
    })
    expect(Object.keys(publicConfig).sort()).toEqual(['canvasContextEnabled', 'imageEventsEnabled'])
  })

  it('briefly caches default settings when the settings table is unavailable', async () => {
    appSettingsError = { message: 'relation "app_settings" does not exist', code: '42P01' }
    const { getAppSettings } = await import('../backend/gateway/src/services/app-settings')

    await expect(getAppSettings({ refresh: true })).resolves.toMatchObject({
      imageCreditCostPerImage: 1,
      imageEventsEnabled: false,
    })
    await expect(getAppSettings()).resolves.toMatchObject({
      imageCreditCostPerImage: 1,
      imageEventsEnabled: false,
    })

    expect(appSettingsSelectCount).toBe(1)
  })

  it('combines database admin rules with env bootstrap admins', async () => {
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
        user_id: null,
        email: 'disabled-admin@example.test',
        enabled: false,
        note: null,
      },
    ]
    const {
      getAdminAccessSummary,
      isConfiguredAdminUser,
    } = await import('../backend/gateway/src/services/app-settings')

    await expect(isConfiguredAdminUser({
      id: '22222222-2222-4222-8222-222222222222',
      email: null,
    })).resolves.toBe(true)
    await expect(isConfiguredAdminUser({
      id: 'user-with-env-email',
      email: 'ENV-ADMIN@example.test',
    })).resolves.toBe(true)
    await expect(isConfiguredAdminUser({
      id: '33333333-3333-4333-8333-333333333333',
      email: 'disabled-admin@example.test',
    })).resolves.toBe(false)

    await expect(getAdminAccessSummary({ refresh: true })).resolves.toMatchObject({
      configured: true,
      databaseCount: 1,
      envUserIdCount: 1,
      envEmailCount: 1,
      tableAvailable: true,
    })
  })
})
