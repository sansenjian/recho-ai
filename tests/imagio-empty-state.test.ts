// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ImagioView from '../src/components/ImagioView.vue'
import i18n from '../src/i18n'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'
import type { GeneratedImage } from '../src/types/image'

function mountView(images: GeneratedImage[] = []) {
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

/**
 * 空态是「还没生成过任何图」时的第一屏:它不该是一个空白的工作区,
 * 而要给出可以一键落进输入框的起点。
 */
describe('Imagio empty state', () => {
  it('renders starter cards instead of an empty transcript', () => {
    const wrapper = mountView()

    expect(wrapper.find('.imagio-transcript').exists()).toBe(false)
    expect(wrapper.find('.imagio-empty').exists()).toBe(true)
    expect(wrapper.findAll('.starter-card')).toHaveLength(3)
    expect(wrapper.find('.imagio-empty').text()).toContain(i18n.global.t('imagio.emptyTitle'))
  })

  it('writes the picked starter into the prompt box', async () => {
    const wrapper = mountView()

    await wrapper.findAll('.starter-card')[1].trigger('click')

    expect((wrapper.find('.prompt-input').element as HTMLTextAreaElement).value)
      .toBe(i18n.global.t('imagio.starterProductPrompt'))
  })

  it('steps aside once something has been generated', () => {
    const wrapper = mountView([{
      id: 'image-1',
      prompt: 'genesis',
      size: 'auto',
      timestamp: '2026-01-01T00:00:00.000Z',
      url: 'https://example.com/result.png',
    }])

    expect(wrapper.find('.imagio-empty').exists()).toBe(false)
    expect(wrapper.find('.imagio-transcript').exists()).toBe(true)
  })
})

/**
 * ImagioView 没有列进 admin-i18n-parity 的扫描名单,它的键要单独兜住:
 * 一处键名写错在 zh 下可能只是显示成键名,在 en 下则整块退化成英文原文。
 */
describe('Imagio i18n keys', () => {
  const keySources = [
    resolve(__dirname, '../src/components/ImagioView.vue'),
    resolve(__dirname, '../src/components/ImageModelSelect.vue'),
  ]

  function referencedKeys(): string[] {
    const found = new Set<string>()
    for (const file of keySources) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\bt\(\s*'(imagio\.[A-Za-z0-9_.]+)'/g)) found.add(match[1])
    }
    return [...found].sort()
  }

  it('resolves every referenced key in both locales', () => {
    const keys = referencedKeys()

    expect(keys.length).toBeGreaterThan(20)
    for (const key of keys) {
      expect(i18n.global.te(key, 'zh'), `zh 缺少 ${key}`).toBe(true)
      expect(i18n.global.te(key, 'en'), `en 缺少 ${key}`).toBe(true)
      expect(i18n.global.t(key, {}, { locale: 'en' })).not.toBe(key)
    }
  })

  it('keeps the imagio namespace aligned between zh and en', () => {
    const zhKeys = Object.keys((zh as { imagio: Record<string, string> }).imagio).sort()
    const enKeys = Object.keys((en as { imagio: Record<string, string> }).imagio).sort()

    expect(zhKeys).toEqual(enKeys)
    expect(zhKeys).toContain('starterPosterPrompt')
  })
})
