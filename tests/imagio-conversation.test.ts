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
