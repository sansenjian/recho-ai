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

  it('treats a preview-only image as actionable', () => {
    // 只有 previewPath 的图同样能从代理取回；显示条件与处理函数必须一致，
    // 否则按钮会显示但点击没有任何反应。
    const w = mountView([{ ...image('img-3'), previewPath: 'supabase://x.preview.webp' }])
    expect(w.find('[aria-label="查看大图"]').attributes('disabled')).toBeUndefined()

    const copy = w.findAll('button').find(b => b.attributes('aria-label') === '复制图片')
    expect(copy).toBeTruthy()
  })

  it('actually fetches a preview-only image when copy is clicked', async () => {
    // 只断言按钮可见是不够的：处理函数若只看 storagePath，点击会静默返回，
    // 界面上什么都不会发生。这里验证点击真的发起了取图请求。
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url))
      return { ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }) }
    }))
    // jsdom 没有剪贴板；缺了它会先被能力检查拦下，测不到取图路径。
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: async () => undefined, writeText: async () => undefined },
      configurable: true,
    })
    const w = mountView([{ ...image('img-3'), previewPath: 'supabase://x.preview.webp' }])
    const copy = w.findAll('button').find(b => b.attributes('aria-label') === '复制图片')!
    await copy.trigger('click')
    await new Promise(r => setTimeout(r, 60))

    // 组件挂载时还会请求应用配置，只看与图片存储相关的那条。
    const imageRequest = urls.find(url => url.includes('/api/image/storage/'))
    expect(imageRequest).toBeDefined()
    expect(imageRequest).toContain('x.preview.webp')
    vi.unstubAllGlobals()
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
