// @vitest-environment jsdom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

/**
 * 图片分析面板。
 *
 * 这个页面最常见的状态是「两张表都没数据」——两个采集开关默认关闭，且前端
 * 埋点与网关落库都还没接线。所以空态是重点：它必须把缺口讲清楚，而不是只显示
 * 一句暂无数据，否则看的人分不清是「坏了」还是「还没开」。
 */

const mocks = vi.hoisted(() => ({
  adminApiJson: vi.fn(),
}))

vi.mock('../src/composables/useAdminApi', () => ({
  adminApiJson: mocks.adminApiJson,
}))

import AdminImageAnalyticsPanel from '../src/components/admin/AdminImageAnalyticsPanel.vue'

const i18n = createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })

function emptyAnalytics(overrides: Record<string, unknown> = {}) {
  return {
    events: {
      total: 0,
      byType: [],
      bySource: [],
      sessions: 0,
      sessionCoverage: 0,
      recent: [],
      sampled: false,
    },
    contexts: {
      total: 0,
      uniqueCanvases: 0,
      averageReferences: null,
      averageMentionedReferences: null,
      averageConnectedReferences: null,
      averagePromptChars: null,
      promptCharsP50: null,
      promptCharsP90: null,
      connectedPromptRate: 0,
      averageNodes: null,
      averageConnections: null,
    },
    users: [],
    windowHours: 168,
    generatedAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  }
}

/** 组件 onMounted 里就发请求，所以要等 promise 与随后的 DOM 更新都完成。 */
async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

async function mountPanel(analytics: unknown) {
  mocks.adminApiJson.mockResolvedValue({ analytics })
  const wrapper = mount(AdminImageAnalyticsPanel, {
    props: { refreshVersion: 0 },
    global: { plugins: [i18n] },
  })
  await flush()
  return wrapper
}

describe('admin image analytics panel', () => {
  afterEach(() => {
    mocks.adminApiJson.mockReset()
  })

  it('requests the analytics endpoint with the default window', async () => {
    const wrapper = await mountPanel(emptyAnalytics())

    expect(mocks.adminApiJson).toHaveBeenCalledTimes(1)
    expect(mocks.adminApiJson.mock.calls[0][0]).toBe('/api/admin/image-analytics?hours=168')
    wrapper.unmount()
  })

  it('explains the collection gaps instead of showing a bare empty state', async () => {
    const wrapper = await mountPanel(emptyAnalytics())
    const text = wrapper.text()

    // 空态标题 + 两条缺口说明都要出现：看的人需要知道「是没开，不是坏了」。
    expect(text).toContain('暂无分析数据')
    expect(text).toContain('图片事件')
    expect(text).toContain('画布上下文')
    expect(text).toContain('前端尚未在查看')
    expect(text).toContain('网关未接收落库')
    wrapper.unmount()
  })

  it('renders event totals and distributions when data exists', async () => {
    const wrapper = await mountPanel(emptyAnalytics({
      events: {
        total: 120,
        byType: [
          { key: 'view_detail', count: 80 },
          { key: 'download', count: 40 },
        ],
        bySource: [{ key: 'works', count: 120 }],
        sessions: 30,
        sessionCoverage: 92.5,
        recent: [],
        sampled: false,
      },
    }))
    const text = wrapper.text()

    expect(text).toContain('120')
    expect(text).toContain('view_detail')
    expect(text).toContain('download')
    expect(text).toContain('30')
    // 占比按分组内总数算：80/120 → 66.7%。
    expect(text).toContain('66.7%')
    wrapper.unmount()
  })

  it('does not show the gap explanations once data arrives', async () => {
    const wrapper = await mountPanel(emptyAnalytics({
      events: {
        total: 5,
        byType: [{ key: 'download', count: 5 }],
        bySource: [{ key: 'works', count: 5 }],
        sessions: 5,
        sessionCoverage: 100,
        recent: [],
        sampled: false,
      },
    }))

    expect(wrapper.text()).not.toContain('暂无分析数据')
    wrapper.unmount()
  })

  it('flags sampled data so nobody reads the distribution as exact', async () => {
    const wrapper = await mountPanel(emptyAnalytics({
      events: {
        total: 999_999,
        byType: [{ key: 'zoom', count: 1 }],
        bySource: [{ key: 'canvas', count: 1 }],
        sessions: 1,
        sessionCoverage: 100,
        recent: [],
        sampled: true,
      },
    }))

    expect(wrapper.text()).toContain('已采样')
    wrapper.unmount()
  })

  it('shows canvas metrics with placeholders for missing values', async () => {
    const wrapper = await mountPanel(emptyAnalytics({
      contexts: {
        total: 12,
        uniqueCanvases: 4,
        averageReferences: 2,
        averageMentionedReferences: null,
        averageConnectedReferences: 3,
        averagePromptChars: 240,
        promptCharsP50: 100,
        promptCharsP90: 800,
        connectedPromptRate: 66.7,
        averageNodes: 20,
        averageConnections: 8,
      },
    }))
    const text = wrapper.text()

    expect(text).toContain('12')
    expect(text).toContain('4')
    expect(text).toContain('66.7%')
    // 分位数要显示出来——均值会被长尾带偏，只有均值会误导。
    expect(text).toContain('100')
    expect(text).toContain('800')
    // null 用占位符，不能渲染成 "null"。
    expect(text).not.toContain('null')
    wrapper.unmount()
  })

  it('surfaces a load failure instead of looking like an empty table', async () => {
    mocks.adminApiJson.mockRejectedValue(new Error('boom'))
    const wrapper = mount(AdminImageAnalyticsPanel, {
      props: { refreshVersion: 0 },
      global: { plugins: [i18n] },
    })
    await flush()

    // 失败必须与「没数据」区分开——两种情况下卡片都是空的。
    expect(wrapper.text()).not.toContain('暂无分析数据')
    wrapper.unmount()
  })

  it('refetches when the window changes', async () => {
    const wrapper = await mountPanel(emptyAnalytics())
    const buttons = wrapper.findAll('button')
    const thirtyDay = buttons.find(button => button.text().includes('30'))
    expect(thirtyDay).toBeTruthy()

    await thirtyDay!.trigger('click')
    await flush()

    expect(mocks.adminApiJson).toHaveBeenCalledTimes(2)
    expect(mocks.adminApiJson.mock.calls[1][0]).toBe('/api/admin/image-analytics?hours=720')
    wrapper.unmount()
  })
})

/**
 * 请求与窗口切换的时序。
 *
 * 这里钉的是一个真实 bug（CodeRabbit 在 #151 上报出、我合并前漏看）：原先
 * loadAnalytics 开头有 `if (loading.value) return`，于是「请求进行中切换时间窗」
 * 会被静默丢弃——上一次请求回来后写入的是旧窗口的数据，而按钮已经高亮到新窗口，
 * 界面长期显示一个与标签不符的数字，而且不会自愈。
 */
describe('admin image analytics panel request ordering', () => {
  afterEach(() => {
    mocks.adminApiJson.mockReset()
  })

  /** 手动控制兑现时机的 deferred，用来制造「请求进行中」这个窗口。 */
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(inner => { resolve = inner })
    return { promise, resolve }
  }

  it('issues a new request when the window changes mid-flight', async () => {
    const first = deferred<unknown>()
    mocks.adminApiJson.mockReturnValueOnce(first.promise)

    const wrapper = mount(AdminImageAnalyticsPanel, {
      props: { refreshVersion: 0 },
      global: { plugins: [i18n] },
    })
    await nextTick()
    expect(mocks.adminApiJson).toHaveBeenCalledTimes(1)

    // 第一次请求还悬着的时候切到 30 天。
    const thirtyDay = wrapper.findAll('button').find(button => button.text().includes('30'))
    await thirtyDay!.trigger('click')
    await nextTick()

    // 旧实现会在这里直接 return，请求数停在 1。
    expect(mocks.adminApiJson).toHaveBeenCalledTimes(2)
    expect(mocks.adminApiJson.mock.calls[1][0]).toBe('/api/admin/image-analytics?hours=720')

    first.resolve({ analytics: emptyAnalytics() })
    await flush()
    wrapper.unmount()
  })

  it('does not let a slow earlier response overwrite a newer one', async () => {
    const slow = deferred<unknown>()
    let call = 0
    // 按调用序号决定返回什么：第一次悬着，第二次立刻给新窗口的数据。
    // 用 mockImplementation 而不是连续 Once，避免队列顺序被别的用例或顺序变化打乱。
    mocks.adminApiJson.mockImplementation(() => {
      call += 1
      if (call === 1) return slow.promise
      return Promise.resolve({ analytics: emptyAnalytics({
        windowHours: 720,
        events: { total: 42, byType: [{ key: 'download', count: 42 }], bySource: [], sessions: 1, sessionCoverage: 100, recent: [], sampled: false },
      }) })
    })

    const wrapper = mount(AdminImageAnalyticsPanel, {
      props: { refreshVersion: 0 },
      global: { plugins: [i18n] },
    })
    await nextTick()

    const thirtyDay = wrapper.findAll('button').find(button => button.text().includes('30'))
    await thirtyDay!.trigger('click')
    await flush()

    // 第二次已回并渲染 30 天的数据。
    expect(wrapper.text()).toContain('42')

    // 第一次（旧窗口）才姗姗回来——它必须被丢掉，不能覆盖上面的结果。
    slow.resolve({ analytics: emptyAnalytics({ windowHours: 24 }) })
    await flush()

    expect(wrapper.text()).toContain('42')
    wrapper.unmount()
  })

  it('keeps loading state until the newest request settles', async () => {
    const slow = deferred<unknown>()
    mocks.adminApiJson.mockReturnValueOnce(slow.promise)

    const wrapper = mount(AdminImageAnalyticsPanel, {
      props: { refreshVersion: 0 },
      global: { plugins: [i18n] },
    })
    await nextTick()

    const thirtyDay = wrapper.findAll('button').find(button => button.text().includes('30'))
    await thirtyDay!.trigger('click')
    await nextTick()
    mocks.adminApiJson.mockResolvedValueOnce({ analytics: emptyAnalytics({ windowHours: 720 }) })
    await flush()

    // 第二次已经回来并渲染了数据；第一次还在悬着，但它不该把界面按回「加载中」，
    // 也不该在它结束时把 loading 收掉——那时界面早就在等别的了。
    expect(wrapper.text()).not.toContain('正在加载分析数据')
    slow.resolve({ analytics: emptyAnalytics({ windowHours: 24 }) })
    await flush()
    expect(wrapper.text()).not.toContain('正在加载分析数据')
    wrapper.unmount()
  })
})
