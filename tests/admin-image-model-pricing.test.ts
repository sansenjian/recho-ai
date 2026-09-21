import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'
import type { AdminAccessSummary, AdminAppSettings, AdminProviderSetting } from '../src/types/admin'

const { adminApiJsonMock } = vi.hoisted(() => ({ adminApiJsonMock: vi.fn() }))

vi.mock('../src/composables/useAdminApi', () => ({
  adminApiJson: adminApiJsonMock,
}))

const baseSettings: AdminAppSettings = {
  imageCreditCostPerImage: 1,
  imageModelCreditCosts: [{ id: 'gpt-image-2', cost: 3 }],
  imageAnalyticsEnabled: false,
  imageResponsesModel: 'gpt-image-2',
  imageResponsesImageModel: 'gpt-image-2',
  imageEventsEnabled: false,
  canvasContextEnabled: false,
  freeGenerationEnabled: true,
  guestGenerationEnabled: true,
  availableImageModels: [],
}

function imageProvider(overrides: Partial<AdminProviderSetting> = {}): AdminProviderSetting {
  return {
    id: 'provider-1',
    kind: 'image',
    name: 'Image Provider',
    baseUrl: 'https://image.example.test/v1',
    enabled: true,
    priority: 10,
    defaultModel: null,
    models: ['gpt-image-2', 'flux-pro', 'image-edit'],
    modelCatalog: [
      { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true },
      { id: 'flux-pro', name: 'Flux Pro', enabled: true },
      // 目录里被停用的模型不参与计费，不该出现在候选里。
      { id: 'retired-model', name: 'Retired', enabled: false },
    ],
    imageModel: 'gpt-image-2',
    editModel: 'image-edit',
    imageCompatibilityMode: 'auto',
    timeoutMs: 360000,
    retryCount: 3,
    supportsWebpReferences: true,
    notes: null,
    apiKeyConfigured: true,
    apiKeyPreview: 'sk-***',
    source: 'database',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

const adminAccess: AdminAccessSummary = {
  configured: true,
  userIdCount: 1,
  emailCount: 0,
  databaseCount: 1,
  envUserIdCount: 0,
  envEmailCount: 0,
  tableAvailable: true,
}

function settingsResponse(settings: AdminAppSettings = baseSettings) {
  return {
    settings,
    adminUsers: [],
    adminAccess,
    providerSettings: { providers: [imageProvider()], tableAvailable: true },
    currentAdminRole: 'senior' as const,
  }
}

async function mountPanel() {
  const AdminSettingsPanel = (await import('../src/components/admin/AdminSettingsPanel.vue')).default
  const wrapper = mount(AdminSettingsPanel, {
    props: { section: 'runtime' },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
    },
  })
  await vi.waitFor(() => {
    expect(adminApiJsonMock).toHaveBeenCalled()
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('runtime config per-model image pricing', () => {
  beforeEach(() => {
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/settings') return settingsResponse()
      throw new Error(`unexpected request: ${url}`)
    })
  })

  it('renders the saved per-model prices next to the fallback price', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.find('#setting-image-price').exists()).toBe(true)
    const idInput = wrapper.find<HTMLInputElement>('#setting-model-price-id-0')
    const costInput = wrapper.find<HTMLInputElement>('#setting-model-price-cost-0')

    expect(idInput.element.value).toBe('gpt-image-2')
    expect(Number(costInput.element.value)).toBe(3)
  })

  it('fills rows for every billable configured model, including the edit model', async () => {
    const wrapper = await mountPanel()

    const fillButton = wrapper.findAll('button').find(button => button.text() === '补齐已配置模型')
    expect(fillButton).toBeDefined()
    await fillButton!.trigger('click')

    const ids = wrapper.findAll<HTMLInputElement>('input[id^="setting-model-price-id-"]').map(input => input.element.value)
    // 目录里启用的模型 + 带参考图时真正计费的编辑模型；被停用的模型不得出现。
    expect(ids).toEqual(['gpt-image-2', 'flux-pro', 'image-edit'])
    expect(ids).not.toContain('retired-model')
  })

  it('includes a per-row catalog edit model in the billable model candidates', async () => {
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/settings') {
        return {
          ...settingsResponse(),
          providerSettings: {
            providers: [imageProvider({
              modelCatalog: [
                { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true, editModel: 'row-edit-model' },
                { id: 'retired-model', name: 'Retired', enabled: false, editModel: 'retired-edit-model' },
              ],
            })],
            tableAvailable: true,
          },
        }
      }
      throw new Error(`unexpected request: ${url}`)
    })

    const wrapper = await mountPanel()

    const fillButton = wrapper.findAll('button').find(button => button.text() === '补齐已配置模型')
    await fillButton!.trigger('click')

    const ids = wrapper.findAll<HTMLInputElement>('input[id^="setting-model-price-id-"]').map(input => input.element.value)
    // 行内编辑模型是带参考图请求的真实扣费模型，必须能单独定价。
    expect(ids).toContain('row-edit-model')
    // 被停用的目录行不参与计费，它的编辑模型也不该成为候选。
    expect(ids).not.toContain('retired-edit-model')
  })

  it('drops blank rows and normalizes costs before saving', async () => {
    const wrapper = await mountPanel()

    const addButton = wrapper.findAll('button').find(button => button.text() === '添加')
    await addButton!.trigger('click')
    // 新行的价格预填兜底价，但 id 为空 —— 保存时必须被丢弃而不是存成空 id。
    await wrapper.find('#setting-model-price-cost-1').setValue(9)

    adminApiJsonMock.mockClear()
    adminApiJsonMock.mockResolvedValueOnce({ settings: baseSettings })
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => {
      expect(adminApiJsonMock.mock.calls.some(call => (call[1] as { method?: string })?.method === 'PATCH')).toBe(true)
    })

    const patchCall = adminApiJsonMock.mock.calls.find(call => (call[1] as { method?: string })?.method === 'PATCH')!
    const body = JSON.parse((patchCall[1] as { body: string }).body) as { imageModelCreditCosts: unknown }
    expect(body.imageModelCreditCosts).toEqual([{ id: 'gpt-image-2', cost: 3 }])
  })

  it('removes a per-model price row on demand', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.find('#setting-model-price-id-0').exists()).toBe(true)
    await wrapper.find('button[aria-label="删除第 1 条模型价格"]').trigger('click')

    expect(wrapper.find('#setting-model-price-id-0').exists()).toBe(false)
    expect(wrapper.text()).toContain('暂无按模型定价')
  })
})

async function mountProviderPanel() {
  const AdminSettingsPanel = (await import('../src/components/admin/AdminSettingsPanel.vue')).default
  const wrapper = mount(AdminSettingsPanel, {
    props: { section: 'providers' },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
    },
  })
  await vi.waitFor(() => {
    expect(adminApiJsonMock).toHaveBeenCalled()
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('provider model catalog row layout', () => {
  beforeEach(() => {
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/settings') return settingsResponse()
      throw new Error(`unexpected request: ${url}`)
    })
  })

  it('renders generation, edit and display model inputs in that order for image providers', async () => {
    const wrapper = await mountProviderPanel()

    // 初始表单目录为空，先加一行才能看到 image 的三输入布局。
    const addButton = wrapper.findAll('button').find(button => button.text() === '添加模型')
    await addButton!.trigger('click')

    const rowInputIds = wrapper.findAll<HTMLInputElement>('input[id^="provider-model-"]').map(input => input.element.id)
    expect(rowInputIds).toEqual([
      'provider-model-id-0',
      'provider-model-edit-0',
      'provider-model-name-0',
    ])
  })

  it('keeps the two-input layout for chat providers', async () => {
    const wrapper = await mountProviderPanel()

    // 切换类型会重置表单，默认给出一行 Chat 模型。
    await wrapper.find('#provider-kind').setValue('chat')
    await wrapper.vm.$nextTick()

    const rowInputIds = wrapper.findAll<HTMLInputElement>('input[id^="provider-model-"]').map(input => input.element.id)
    expect(rowInputIds).toEqual(['provider-model-id-0', 'provider-model-name-0'])
  })
})
