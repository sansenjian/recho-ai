// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import ImagioView from '../src/components/ImagioView.vue'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

vi.mock('../src/composables/useMessageFeedback', () => ({
  useMessageFeedback: () => ({ values: { value: {} }, load: vi.fn(), submit: vi.fn() }),
}))

/** 复制走 fetch 拿 blob，这里给出固定字节。 */
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const writeCalls: unknown[] = []

function mountWithImage() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, blob: async () => new Blob([PNG], { type: 'image/png' }),
  })))
  vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
  Object.defineProperty(navigator, 'clipboard', {
    value: { write: async (items: unknown[]) => { writeCalls.push(items) } },
    configurable: true,
  })
  return mount(ImagioView, {
    props: {
      generatedImages: [{
        id: 'img-1', generationBatchId: 'b1', prompt: 'a dot', userPrompt: 'a dot',
        size: '1024x1024', timestamp: new Date().toISOString(), creditCost: 0.3,
        storagePath: 'supabase://x.png',
      }],
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
      stubs: { AuthenticatedImage: { template: '<img />' }, ChatMessageRail: true },
    },
  })
}

describe('imagio copy button', () => {
  it('labels the copy action as copying an image', () => {
    const w = mountWithImage()
    const copy = w.findAll('button').find(b => b.attributes('aria-label') === '复制图片')
    expect(copy).toBeTruthy()
  })

  it('writes the image to the clipboard, not the prompt text', async () => {
    writeCalls.length = 0
    const w = mountWithImage()
    const copy = w.findAll('button').find(b => b.attributes('aria-label') === '复制图片')!
    await copy.trigger('click')
    await new Promise(r => setTimeout(r, 80))
    // 复制的是图片：剪贴板收到 ClipboardItem，而不是一段文本。
    expect(writeCalls.length).toBe(1)
    expect(writeCalls[0]).toBeInstanceOf(Array)
  })
})
