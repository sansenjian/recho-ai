import { beforeEach, describe, expect, it, vi } from 'vitest'

// 覆盖「用户可见模型」：管理员在后台配置的 available_image_models 就是权威列表，
// 非空时它决定用户看到哪些模型，为空时才回退到已启用 Provider 的推导结果。

let appSettingRows: Array<Record<string, unknown>> = []
let providerSettingRows: Array<Record<string, unknown>> = []

vi.mock('../backend/gateway/src/config', () => ({
  ADMIN_USER_EMAILS: [],
  ADMIN_USER_IDS: [],
  CANVAS_CONTEXT_ENABLED: false,
  FREE_GENERATION_ENABLED: true,
  GUEST_GENERATION_ENABLED: true,
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
  OPENAI_B64_JSON_ENABLED: false,
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
      if (table === 'app_settings') {
        return { select: vi.fn(async () => ({ data: appSettingRows, error: null })) }
      }
      if (table === 'provider_settings') {
        const chain: Record<string, unknown> = {
          order: vi.fn(() => chain),
          then: (resolve: (value: unknown) => void) => resolve({ data: providerSettingRows, error: null }),
        }
        return { select: vi.fn(() => chain) }
      }
      if (table === 'admin_users') {
        return { select: vi.fn(() => ({ order: vi.fn(async () => ({ data: [], error: null })) })) }
      }
      return { select: vi.fn(() => ({ order: vi.fn(async () => ({ data: [], error: null })) })) }
    },
  }),
}))

function imageProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'image',
    name: 'Image Provider',
    base_url: 'https://image.example.test/v1',
    models: [],
    model_catalog: [],
    image_model: 'gpt-image-2',
    edit_model: null,
    enabled: true,
    priority: 1,
    timeout_ms: 360000,
    retry_count: 3,
    api_key_encrypted: 'encrypted',
    ...overrides,
  }
}

describe('user-visible image models', () => {
  beforeEach(async () => {
    appSettingRows = []
    providerSettingRows = []
    // 两个缓存都要清。只清 app_settings 时，先跑的用例会把 Provider 结果留在
    // 缓存里，后续用例即使自己的 fixture 没加载也能通过——测试之间互相借数据，
    // 断言就失去意义。
    const appSettings = await import('../backend/gateway/src/services/app-settings')
    appSettings.clearAppSettingsCache()
    const providerSettings = await import('../backend/gateway/src/services/provider-settings')
    providerSettings.clearProviderSettingsCache()
  })

  it('shows exactly what the admin configured, hiding other provider models', async () => {
    // 管理员只开放 gpt-image-2.5，即使 Provider 还提供别的模型也不该出现。
    appSettingRows = [
      { key: 'available_image_models', value: [{ id: 'gpt-image-2.5', name: 'GPT Image 2.5' }] },
    ]
    providerSettingRows = [
      imageProviderRow({
        model_catalog: [
          { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true },
          { id: 'gpt-image-2.5', name: 'GPT Image 2.5', enabled: true },
          { id: 'gpt-image-2.5-flare', name: 'Flare', enabled: true },
        ],
      }),
    ]

    const { publicAppConfig } = await import('../backend/gateway/src/services/app-settings')
    const config = await publicAppConfig()

    expect(config.availableImageModels.map(m => m.id)).toEqual(['gpt-image-2.5'])
  })

  it('shows every enabled provider model when the admin configured none', async () => {
    // 没配置时不能是空列表，否则前端没有模型可选。
    providerSettingRows = [
      imageProviderRow({
        model_catalog: [
          { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true },
          { id: 'gpt-image-2.5-flare', name: 'Flare', enabled: true },
        ],
      }),
    ]

    const { publicAppConfig } = await import('../backend/gateway/src/services/app-settings')
    const config = await publicAppConfig()

    // 目录里的启用项都要出现。环境变量的兜底模型也可能一并列出，
    // 这里只断言目录项在不在，不把兜底模型钉死。
    const ids = config.availableImageModels.map(m => m.id)
    expect(ids).toContain('gpt-image-2')
    expect(ids).toContain('gpt-image-2.5-flare')
  })

  it('keeps the configured display name', async () => {
    // 后台可以给模型起展示名，前台下拉框要用它而不是模型 ID。
    appSettingRows = [
      { key: 'available_image_models', value: [{ id: 'gpt-image-2.5', name: '旗舰生图' }] },
    ]

    const { publicAppConfig } = await import('../backend/gateway/src/services/app-settings')
    const config = await publicAppConfig()

    expect(config.availableImageModels[0]).toMatchObject({ id: 'gpt-image-2.5', name: '旗舰生图' })
  })

  it('keeps the default model inside the configured list', async () => {
    // 默认选中模型必须落在可见列表内，否则前端会把它补回下拉框，
    // 被管理员隐藏的模型就又出现了。
    appSettingRows = [
      { key: 'available_image_models', value: [{ id: 'only-model', name: 'Only' }] },
      { key: 'image_responses_image_model', value: 'hidden-model' },
    ]
    providerSettingRows = [imageProviderRow({ image_model: 'hidden-model' })]

    const { publicAppConfig } = await import('../backend/gateway/src/services/app-settings')
    const config = await publicAppConfig()

    expect(config.defaultImageModel).toBe('only-model')
  })
})
