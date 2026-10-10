// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminSettingsPanel from '../src/components/admin/AdminSettingsPanel.vue'
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

// AdminSettingsPanel 在模块顶层导入：这个 SFC 的编译成本落在模块收集阶段，
// 不再占用某一条用例的 5s testTimeout 预算。
// 原先在 mountPanel() 里动态 import，等于让「第一条跑到的用例」独自扛下编译
// （实测该用例 2.4–2.9s，其余 6 条各约 1ms），而「哪条算第一」会随 -t 过滤、
// 分片、随机顺序变化 ⇒ 负载稍高就会偶发超时，且换一条用例先跑还会复现。
async function mountPanel() {
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

/**
 * 取「生图模型」那一行的提示文本。
 *
 * 用具体容器而不是整页文本：页面别处也有「回退兜底价」这类措辞，整页匹配会误判。
 */
function defaultModelNotice(wrapper: ReturnType<typeof mount>): string {
  // 提示挂在控件列里，与 <label> 是兄弟节点，所以要从字段容器取而不是从 label 取。
  const field = wrapper.findAll('[data-slot="settings-field"]')
    .find(node => node.find('#setting-image-model').exists())
  if (!field) return ''
  // 字段里唯一的 <p> 就是提示行；标签、说明与 hint 都是 <span>。
  const hint = field.findAll('p')[0]
  return hint ? hint.text() : ''
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

  it('fills visible-model rows from enabled providers when the list is empty', async () => {
    // 走面板自己的按钮，而不是直接调工具函数：填充逻辑一度在组件里各写一份，
    // 工具函数的单测无法证明按钮真的会补出行来。
    const wrapper = await mountPanel()

    const fillButton = wrapper.findAll('button').find(button => button.text() === '带入已启用模型')
    expect(fillButton).toBeDefined()
    await fillButton!.trigger('click')
    await wrapper.vm.$nextTick()

    const ids = wrapper.findAll<HTMLInputElement>('input[id^="setting-visible-model-id-"]').map(input => input.element.value)
    expect(ids).toEqual(['gpt-image-2', 'flux-pro'])
  })

  it('adds an editable blank row when there is nothing to fill in', async () => {
    // 一个 Provider 都没启用时，按钮仍须给出可手填的一行，否则无从下手。
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/settings') {
        return {
          ...settingsResponse(),
          providerSettings: { providers: [imageProvider({ enabled: false })], tableAvailable: true },
        }
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const wrapper = await mountPanel()

    // 定价面板与可见模型面板各有一个「添加」，必须限定在可见模型区块内取，
    // 否则 find() 会返回定价表那一个：两个区块都在同一个选择器范围内。
    const section = wrapper.findAll('[data-slot="settings-section"]')[1]
    const addButton = section.findAll('button').find(button => button.text() === '添加')
    expect(addButton).toBeDefined()
    await addButton!.trigger('click')
    await wrapper.vm.$nextTick()

    const ids = section.findAll<HTMLInputElement>('input[id^="setting-visible-model-id-"]')
      .map(input => input.element.value)
    expect(ids).toEqual([''])
  })


  it('splits the settings into labelled groups instead of one flat column', async () => {
    // 原先九项平铺在一列，改价、选模型、开关混在一起，看不出层次也找不到重点。
    const wrapper = await mountPanel()

    const titles = wrapper.findAll('[data-slot="settings-group"]')
      .map(group => group.find('button').text())
    expect(titles.some(title => title.includes('计费'))).toBe(true)
    expect(titles.some(title => title.includes('模型'))).toBe(true)
    expect(titles.some(title => title.includes('功能开关'))).toBe(true)
  })

  it('collapses the low-frequency flags by default', async () => {
    const wrapper = await mountPanel()

    const flags = wrapper.findAll('[data-slot="settings-group"]')
      .find(group => group.find('button').text().includes('功能开关'))!
    expect(flags.find('button').attributes('aria-expanded')).toBe('false')

    await flags.find('button').trigger('click')
    expect(flags.find('button').attributes('aria-expanded')).toBe('true')
  })

  it('keeps the billing group open by default', async () => {
    // 计费是天天要改的，不该藏起来。
    const wrapper = await mountPanel()

    const billing = wrapper.findAll('[data-slot="settings-group"]')
      .find(group => group.find('button').text().includes('计费'))!
    expect(billing.find('button').attributes('aria-expanded')).toBe('true')
  })

  it('still submits every field after grouping', async () => {
    // 分组只改布局，提交内容必须与原先一致。
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/settings' && init?.method === 'PATCH') return { settings: baseSettings }
      if (url === '/api/admin/settings') return settingsResponse()
      throw new Error(`unexpected request: ${url}`)
    })
    const wrapper = await mountPanel()

    await wrapper.find('form').trigger('submit')

    const patch = adminApiJsonMock.mock.calls.find(call => (call[1] as RequestInit)?.method === 'PATCH')
    expect(patch).toBeDefined()
    // 可见模型列表只有被改动时才会带上，这里没动过，所以不在提交里。
    expect(Object.keys(JSON.parse(String((patch![1] as RequestInit).body))).sort()).toEqual([
      'canvasContextEnabled',
      'freeGenerationEnabled',
      'guestGenerationEnabled',
      'imageAnalyticsEnabled',
      'imageCreditCostPerImage',
      'imageEventsEnabled',
      'imageModelCreditCosts',
      'imageResponsesImageModel',
    ])
  })


  it('no longer renders the retired responses-model field', async () => {
    // image_responses_model 已弃用：它只被存回库里，没有任何地方读它去决定模型。
    // 留一个配了不生效的输入框比没有更容易误导。
    const wrapper = await mountPanel()

    expect(wrapper.find('#setting-response-model').exists()).toBe(false)
    expect(wrapper.find('#setting-image-model').exists()).toBe(true)
  })

  it('warns when the default image model is not user-visible', async () => {
    // 后端要求默认模型落在可见列表里，否则回退到列表首项。配了却不生效最容易
    // 被当成故障，所以界面上要直接说明实际会生效的是哪个。
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/settings') {
        return {
          ...settingsResponse({
            ...baseSettings,
            imageResponsesImageModel: 'hidden-model',
            availableImageModels: [{ id: 'visible-model', name: '', supportsTransparent: false }],
          }),
        }
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const wrapper = await mountPanel()

    const notice = defaultModelNotice(wrapper)
    expect(notice).toContain('hidden-model')
    expect(notice).toContain('visible-model')
  })

  it('stays quiet when the default image model is visible', async () => {
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/settings') {
        return {
          ...settingsResponse({
            ...baseSettings,
            imageResponsesImageModel: 'visible-model',
            availableImageModels: [{ id: 'visible-model', name: '', supportsTransparent: false }],
          }),
        }
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const wrapper = await mountPanel()

    expect(defaultModelNotice(wrapper)).toBe('')
  })

  it('stays quiet when the visible list is empty, since the gateway decides', async () => {
    // 空列表表示跟随 Provider，本地无从判断该提示什么。
    const wrapper = await mountPanel()

    expect(defaultModelNotice(wrapper)).toBe('')
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

    const rowInputs = wrapper.findAll<HTMLInputElement>('input[id^="provider-model-"]')
    expect(rowInputs.map(input => input.element.id)).toEqual([
      'provider-model-id-0',
      'provider-model-edit-0',
      'provider-model-name-0',
      'provider-model-transparent-0',
    ])
    // 透明能力是复选开关，缺省不勾选：漏配比「以为能透明」安全。
    expect(rowInputs[3].element.type).toBe('checkbox')
    expect(rowInputs[3].element.checked).toBe(false)
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
