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

function mountView(images: unknown[]) {
  return mount(ImagioView, {
    props: { generatedImages: images as never },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
      stubs: { AuthenticatedImage: { template: '<img />' }, ChatMessageRail: true },
    },
  })
}

function image(id: string, storagePath?: string) {
  return {
    id, generationBatchId: 'b1', prompt: 'a dot', userPrompt: 'a dot',
    size: '1024x1024', timestamp: new Date().toISOString(), creditCost: 0.3,
    ...(storagePath ? { storagePath } : {}),
  }
}

describe('imagio image viewer', () => {
  it('makes a stored image clickable to open the viewer', () => {
    const w = mountView([image('img-1', 'supabase://x.png')])
    const button = w.find('[aria-label="查看大图"]')
    expect(button.exists()).toBe(true)
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('disables the entry while the image has no storage path yet', () => {
    // 还在生成的图没有路径，点开只会得到一个空白弹窗。
    const w = mountView([image('img-2')])
    const button = w.find('[aria-label="查看大图"]')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('does not render the viewer until an image is opened', () => {
    const w = mountView([image('img-1', 'supabase://x.png')])
    expect(w.findComponent({ name: 'ImageViewerModal' }).exists()).toBe(false)
  })

  it('opens the viewer on click and closes it again', async () => {
    // 光有按钮不算数：点下去必须真的出现大图弹窗。
    const w = mountView([image('img-1', 'supabase://x.png')])
    await w.find('[aria-label="查看大图"]').trigger('click')
    expect(w.findComponent({ name: 'ImageViewerModal' }).exists()).toBe(true)

    await w.findComponent({ name: 'ImageViewerModal' }).vm.$emit('close')
    await w.vm.$nextTick()
    expect(w.findComponent({ name: 'ImageViewerModal' }).exists()).toBe(false)
  })

  it('zooms within a usable range', async () => {
    const w = mountView([image('img-1', 'supabase://x.png')])
    await w.find('[aria-label="查看大图"]').trigger('click')
    const viewer = w.findComponent({ name: 'ImageViewerModal' })
    expect(viewer.props('viewer').zoom).toBe(1)

    // 反复缩小不应穿过下限，否则图片会消失在视野里。
    for (let i = 0; i < 20; i++) viewer.vm.$emit('zoom', -0.12)
    await w.vm.$nextTick()
    expect(w.findComponent({ name: 'ImageViewerModal' }).props('viewer').zoom).toBeGreaterThanOrEqual(0.4)

    for (let i = 0; i < 40; i++) w.findComponent({ name: 'ImageViewerModal' }).vm.$emit('zoom', 0.12)
    await w.vm.$nextTick()
    expect(w.findComponent({ name: 'ImageViewerModal' }).props('viewer').zoom).toBeLessThanOrEqual(3)
  })
})
