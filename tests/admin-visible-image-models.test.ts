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
        return {
          select: vi.fn(async () => ({ data: appSettingRows, error: null })),
          // 写入路径会 upsert 后回读，这里把行直接记回内存，让「保存后读回」成立。
          upsert: vi.fn(async (rows: Array<Record<string, unknown>>) => {
            for (const row of Array.isArray(rows) ? rows : [rows]) {
              const key = String(row.key)
              const existing = appSettingRows.find(r => r.key === key)
              let value = row.value
              if (typeof value === 'string') {
                try { value = JSON.parse(value) } catch { /* 保留原值 */ }
              }
              if (existing) existing.value = value
              else appSettingRows.push({ key, value })
            }
            return { error: null }
          }),
        }
      }
      if (table === 'provider_settings') {
        const chain: Record<string, unknown> = {
          is: vi.fn(() => chain),
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

// 写入路径要求记录操作者，测试里给一个稳定身份即可。
const TEST_ADMIN = { id: 'admin-1', email: 'admin@example.test' } as never

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


  it('treats an explicit empty list as following the providers', async () => {
    // 空列表是合法的赋值，语义为「跟随已启用 Provider」。它必须能清掉限制，
    // 否则管理员没有回到跟随状态的途径。
    appSettingRows = [
      { key: 'available_image_models', value: [{ id: 'pinned-model', name: 'Pinned' }] },
    ]
    providerSettingRows = [
      imageProviderRow({
        model_catalog: [{ id: 'provider-model', name: 'From Provider', enabled: true }],
      }),
    ]

    const mod = await import('../backend/gateway/src/services/app-settings')
    mod.clearAppSettingsCache()
    const { updateAppSettings, publicAppConfig } = mod
    await updateAppSettings({ availableImageModels: [] } as never, TEST_ADMIN)
    mod.clearAppSettingsCache()

    const config = await publicAppConfig()
    expect(config.availableImageModels.map(m => m.id)).toContain('provider-model')
    expect(config.availableImageModels.map(m => m.id)).not.toContain('pinned-model')
  })

  it('keeps the stored list when the input is unusable', async () => {
    // 无法识别的输入（不是数组、解析不了的 JSON 文本）必须保留原值。
    // 若把它当成空列表，一个拼错的请求体就会悄悄抹掉可见模型限制。
    appSettingRows = [
      { key: 'available_image_models', value: [{ id: 'keep-me', name: 'Keep' }] },
    ]

    const mod = await import('../backend/gateway/src/services/app-settings')
    mod.clearAppSettingsCache()
    const { updateAppSettings } = mod
    for (const bad of [null, 42, '{not json', 'nope'] as const) {
      const saved = await updateAppSettings({ availableImageModels: bad } as never, TEST_ADMIN)
      expect(saved.availableImageModels.map(m => m.id)).toEqual(['keep-me'])
    }
  })

  it('drops unusable entries but keeps the ones that parse', async () => {
    // 条目级别写坏时保留其余可用的，而不是整份作废。
    appSettingRows = []
    const mod = await import('../backend/gateway/src/services/app-settings')
    mod.clearAppSettingsCache()
    const saved = await mod.updateAppSettings({
      availableImageModels: [
        { id: 'good-one', name: 'Good' },
        { id: '   ', name: 'blank id' },
        null,
        { name: 'no id' },
      ],
    } as never, TEST_ADMIN)

    expect(saved.availableImageModels.map(m => m.id)).toEqual(['good-one'])

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
