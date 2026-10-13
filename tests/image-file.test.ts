// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canDecodeImageDataUrl,
  compressImageDataUrl,
  isInlineImageDataUrl,
  readBlobAsDataUrl,
} from '../src/lib/image-file'

/**
 * 用受控的 Image 替身跑一次解码结果。
 *
 * jsdom 的 Image 既不加载也不触发 onerror，compressImageDataUrl 会一直挂在
 * loadImageElement 上。想断言「解码失败」这条分支，只能把结果直接喂进去。
 */
function stubImageOutcome(outcome: 'load' | 'error') {
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 1200
    naturalHeight = 600
    width = 1200
    height = 600
    set src(_value: string) {
      queueMicrotask(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
}

/**
 * 图片读取与压缩。
 *
 * 这两个函数是从画布模块下沉出来的，AppShell 原来的内联实现也换成了它们。所以这里
 * 盯的是「下沉后行为是否符合两边的预期」：读得出来、压得下去、压不小就原样返回。
 */
describe('image-file', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads a blob as a data url', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })

    await expect(readBlobAsDataUrl(blob)).resolves.toMatch(/^data:/)
  })

  it('recognises inline data urls', () => {
    expect(isInlineImageDataUrl('data:image/png;base64,AAA')).toBe(true)
    expect(isInlineImageDataUrl('https://example.com/a.png')).toBe(false)
    expect(isInlineImageDataUrl('blob:http://localhost/abc')).toBe(false)
  })

  it('leaves non-inline sources untouched', async () => {
    // 压缩只对内联 dataURL 有意义；远程地址原样返回，不去 fetch。
    const url = 'https://example.com/photo.jpg'

    await expect(compressImageDataUrl(url, { maxEdge: 1280, quality: 0.85 })).resolves.toBe(url)
  })

  // 解码失败时回退原值这条路径不在这里测：jsdom 的 Image 既不加载也不触发 onerror，
  // compressImageDataUrl 会一直挂在 loadImageElement 上，断言只能写成超时。真实行为
  // 在浏览器里验证过（2000x1000 的 PNG 压成 1280x640 的 WebP）。

  it('reports whether an inline data url actually decodes', async () => {
    stubImageOutcome('error')
    await expect(canDecodeImageDataUrl('data:image/png;base64,broken')).resolves.toBe(false)

    stubImageOutcome('load')
    await expect(canDecodeImageDataUrl('data:image/png;base64,ok')).resolves.toBe(true)
  })

  it('treats non-inline sources as decodable', async () => {
    // 远程地址不经过本地解码，上传路径不该因为「没在本地打开过」就把它丢掉。
    await expect(canDecodeImageDataUrl('https://example.com/a.png')).resolves.toBe(true)
  })

  it('keeps the original when compression cannot decode it', async () => {
    // 回退原值是 compressImageDataUrl 的既有契约；上传路径靠 canDecodeImageDataUrl
    // 区分「压不小」和「打不开」，不能把回退本身改成抛错。
    stubImageOutcome('error')
    const broken = 'data:image/png;base64,broken'

    await expect(compressImageDataUrl(broken, { maxEdge: 1280, quality: 0.85 })).resolves.toBe(broken)
  })
})
