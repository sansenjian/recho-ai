// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import ImagioView from '../src/components/ImagioView.vue'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

// ImagioView 依赖后端接口，这里只关心模板是否把操作栏渲染出来。
vi.mock('../src/composables/useMessageFeedback', () => ({
  useMessageFeedback: () => ({
    values: { value: {} },
    load: vi.fn(),
    submit: vi.fn(async () => true),
  }),
}))

function mountView() {
  return mount(ImagioView, {
    props: {
      generatedImages: [{
        id: 'img-1',
        generationBatchId: 'batch-1',
        prompt: 'a dot',
        userPrompt: 'a dot',
        size: '1024x1024',
        timestamp: new Date().toISOString(),
        creditCost: 0.3,
      }],
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
      stubs: { AuthenticatedImage: { template: '<img />' }, ChatMessageRail: true },
    },
  })
}

describe('ImagioView action bar', () => {
  it('renders the action bar under a generated turn', () => {
    const w = mountView()
    const html = w.html()
    expect(html).toContain('lucide-copy')
    expect(html).toContain('lucide-thumbs-up')
    expect(html).toContain('lucide-thumbs-down')
    expect(html).toContain('lucide-download')
  })

  it('marks the turn container as a hover group so the bar can appear', () => {
    // 操作栏默认 opacity-0 靠 group-hover 浮现；父级没有 group 就永远看不见。
    const w = mountView()
    const turn = w.find('.conversation-turn')
    expect(turn.exists()).toBe(true)
    expect(turn.classes()).toContain('group')
  })

  it('shows the credit cost for the turn', () => {
    const w = mountView()
    expect(w.text()).toContain('额度')
  })
})
