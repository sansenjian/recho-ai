// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthenticatedImage from '../src/components/AuthenticatedImage.vue'
import ImagioView from '../src/components/ImagioView.vue'
import i18n from '../src/i18n'
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
    expect(cell.findComponent(AuthenticatedImage).exists()).toBe(true)
    expect(cell.text()).not.toContain('图片处理中')
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
