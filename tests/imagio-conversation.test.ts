// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthenticatedImage from '../src/components/AuthenticatedImage.vue'
import ImagioView from '../src/components/ImagioView.vue'
import i18n from '../src/i18n'
import { fetchAuthenticatedImageObjectUrl } from '../src/lib/authenticated-image-source'
import type { GeneratedImage } from '../src/types/image'

// Keep the guard and storage-path resolution real, but never touch the network.
vi.mock('../src/lib/authenticated-image-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/authenticated-image-source')>()
  return {
    ...actual,
    fetchAuthenticatedImageObjectUrl: vi.fn().mockRejectedValue(new Error('offline in tests')),
  }
})

function generatedImage(overrides: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: 'image-1',
    prompt: '生成刀剑神域海报',
    size: 'auto',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountView(images: GeneratedImage[]) {
  return mount(ImagioView, {
    props: {
      generate: vi.fn(),
      isGenerating: false,
      error: null,
      generatedImages: images,
    },
    global: { plugins: [i18n] },
  })
}

describe('Imagio conversation turns', () => {
  beforeEach(() => {
    localStorage.clear()
  })


  it('scrolls the conversation to the latest message on mount', async () => {
    // 打开工作台对话时原先没有任何滚动逻辑，浏览器停在默认位置——列表顶部，
    // 也就是最老的一条。长会话每次都要手动拉到底。
    const scrollTo = vi.fn()
    const original = HTMLElement.prototype.scrollTo
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollTo,
    })
    // 每帧都返回一个稳定高度，让收敛判定立刻成立。
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return 4000 },
    })
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })

    try {
      const wrapper = mountView([
        generatedImage({ id: 'a', url: 'https://example.com/a.png' }),
        generatedImage({ id: 'b', url: 'https://example.com/b.png' }),
      ])
      await flushPromises()

      const scroller = wrapper.find('.imagio-conversation')
      expect(scroller.exists()).toBe(true)
      expect(scrollTo).toHaveBeenCalled()
      const lastCall = scrollTo.mock.calls.at(-1)![0] as ScrollToOptions
      expect(lastCall.top).toBe(4000)
    } finally {
      raf.mockRestore()
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: original })
      if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalHeight)
    }
  })

  it('does not yank the view back down when the user browses history', async () => {
    // 初次定位只做一次：用户往回翻历史时，列表变化不能再把他拽回底部。
    const scrollTo = vi.fn()
    const original = HTMLElement.prototype.scrollTo
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 4000 } })
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 1 })

    try {
      const wrapper = mountView([generatedImage({ id: 'a', url: 'https://example.com/a.png' })])
      await flushPromises()
      const afterMount = scrollTo.mock.calls.length

      // 追加一条消息：此时用户可能正在看历史，不该再次强行滚到底。
      await wrapper.setProps({
        generatedImages: [
          generatedImage({ id: 'a', url: 'https://example.com/a.png' }),
          generatedImage({ id: 'b', url: 'https://example.com/b.png' }),
        ],
      })
      await flushPromises()

      expect(scrollTo.mock.calls.length).toBe(afterMount)
    } finally {
      raf.mockRestore()
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: original })
      if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalHeight)
    }
  })


  it('still scrolls when history arrives after an empty mount', async () => {
    // 挂载那刻历史数据往往还没到，容器是 null。若这时就消耗掉「已定位」标记，
    // 等数据到达后 watcher 会被挡掉，结果是打开工作台永远不滚动。
    const scrollTo = vi.fn()
    const original = HTMLElement.prototype.scrollTo
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 5000 } })
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 1 })

    try {
      // 先以空列表挂载。
      const wrapper = mountView([])
      await flushPromises()
      expect(scrollTo).not.toHaveBeenCalled()

      // 历史数据随后到达。
      await wrapper.setProps({ generatedImages: [generatedImage({ url: 'https://example.com/late.png' })] })
      await flushPromises()

      expect(scrollTo).toHaveBeenCalled()
      const lastCall = scrollTo.mock.calls.at(-1)![0] as ScrollToOptions
      expect(lastCall.top).toBe(5000)
    } finally {
      raf.mockRestore()
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: original })
      if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalHeight)
    }
  })

  it('renders the user prompt before the generation result', () => {
    const wrapper = mountView([generatedImage({ url: 'https://example.com/result.png' })])
    const turn = wrapper.find('.conversation-turn')

    expect(turn.exists()).toBe(true)
    expect([...turn.element.children].map(child => (child as HTMLElement).className))
      .toEqual(['conversation-user', 'conversation-ai'])
  })

  it('loads a result that only has a storage path through the authenticated source', () => {
    const wrapper = mountView([generatedImage({ storagePath: 'user/image-1.png' })])
    const cell = wrapper.find('.conversation-image')

    expect(cell.exists()).toBe(true)
    const image = cell.findComponent(AuthenticatedImage)
    expect(image.exists()).toBe(true)
    // 只断言「子组件存在」是不够的：模式退化成 thumbnail、或干脆绕过鉴权加载都能过。
    expect(image.props('mode')).toBe('preview')
    expect(cell.text()).not.toContain('图片处理中')
  })

  it('fetches the authenticated preview path instead of the raw storage path', async () => {
    const fetchMock = vi.mocked(fetchAuthenticatedImageObjectUrl)
    fetchMock.mockClear()
    mountView([generatedImage({
      storagePath: 'user/image-1.png',
      previewPath: 'preview/image-1.png',
    })])

    await flushPromises()

    // preview 模式必须先取 previewPath；只有它失败才回落到 storagePath（顺序即优先级）。
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'preview/image-1.png',
      'user/image-1.png',
    ])
    expect(fetchMock).toHaveBeenCalledWith('preview/image-1.png', expect.anything())
  })

  it('keeps the placeholder when a result has no image source at all', () => {
    const wrapper = mountView([generatedImage()])
    const cell = wrapper.find('.conversation-image')

    expect(cell.exists()).toBe(true)
    expect(cell.findComponent(AuthenticatedImage).exists()).toBe(false)
    expect(cell.text()).toContain('图片处理中')
  })
})

/**
 * 工作台的轮次导航复用对话页那条轨道，只是轮次来源换成生成批次。
 * 一格 = 一条提问，所以断言的重点是「标记数量跟着提问走，而不是跟着图片走」。
 */
describe('Imagio conversation rail', () => {
  const RAIL = '[data-slot="chat-turn-rail"]'

  function batch(batchId: string, prompt: string, imageCount: number): GeneratedImage[] {
    return Array.from({ length: imageCount }, (_, index) => generatedImage({
      id: `${batchId}-image-${index + 1}`,
      generationBatchId: batchId,
      userPrompt: prompt,
      timestamp: '2026-01-01T00:00:00.000Z',
      url: `https://example.com/${batchId}-${index + 1}.png`,
    }))
  }

  it('shows one marker per generation batch, not per image', () => {
    const wrapper = mountView([...batch('turn-1', '第一轮提问', 2), ...batch('turn-2', '第二轮提问', 3)])

    const markers = wrapper.find(RAIL).findAll('button')

    expect(markers).toHaveLength(2)
    expect(markers[0].attributes('aria-label')).toBe(i18n.global.t('chat.jumpToTurn', { index: 1 }))
    expect(markers[1].attributes('aria-label')).toBe(i18n.global.t('chat.jumpToTurn', { index: 2 }))
  })

  it('renders no rail while nothing has been generated', () => {
    const wrapper = mountView([])

    expect(wrapper.find(RAIL).exists()).toBe(false)
  })

  it('summarizes the image count of a turn in the hover card', async () => {
    const wrapper = mountView(batch('turn-1', '生成刀剑神域海报', 2))

    await wrapper.find(RAIL).findAll('button')[0].trigger('mouseenter')

    const card = wrapper.find('[data-slot="chat-turn-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('生成刀剑神域海报')
    expect(card.text()).toContain(i18n.global.t('chat.turnImages', { count: 2 }))
  })

  it('anchors every turn so the rail can jump to it', () => {
    const wrapper = mountView([...batch('turn-1', '第一轮提问', 1), ...batch('turn-2', '第二轮提问', 1)])

    const id = wrapper.findAll('.conversation-turn')[0].attributes('data-turn-id')

    expect(wrapper.findAll('.conversation-turn')).toHaveLength(2)
    expect(wrapper.find(RAIL).exists()).toBe(true)
    // 标记与轮次一一对应：点第一个标记不应越界到第二轮。
    expect(wrapper.find(RAIL).findAll('button')).toHaveLength(2)
    expect(id).toBeUndefined()
  })
})
