// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import ChatMessage from '../src/components/ChatMessage.vue'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

function mountMsg(extra: Record<string, unknown> = {}) {
  return mount(ChatMessage, {
    props: {
      msg: {
        id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-10-10T12:00:00.000Z',
        ...extra,
      },
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })] },
  })
}

describe('assistant message action bar', () => {
  it('renders copy, like, dislike and retry', () => {
    const w = mountMsg()
    const html = w.html()
    expect(html).toContain('lucide-copy')
    expect(html).toContain('lucide-thumbs-up')
    expect(html).toContain('lucide-thumbs-down')
    expect(html).toContain('lucide-refresh-cw')
  })

  it('emits feedback with 1 when liking, and 0 to undo', async () => {
    const w = mountMsg()
    const like = w.findAll('button').find(b => b.attributes('aria-label') === '有帮助')!
    await like.trigger('click')
    expect(w.emitted('feedback')?.[0]).toEqual([1])

    // 再点一次已经选中的好评应当撤销。
    await w.setProps({ feedback: 1 })
    await like.trigger('click')
    expect(w.emitted('feedback')?.[1]).toEqual([0])
  })

  it('marks the chosen direction as pressed for screen readers', async () => {
    const w = mountMsg()
    expect(w.find('[aria-label="有帮助"]').attributes('aria-pressed')).toBe('false')
    expect(w.find('[aria-label="没帮助"]').attributes('aria-pressed')).toBe('false')

    await w.setProps({ feedback: 1 })
    expect(w.find('[aria-label="有帮助"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[aria-label="没帮助"]').attributes('aria-pressed')).toBe('false')
  })
})
