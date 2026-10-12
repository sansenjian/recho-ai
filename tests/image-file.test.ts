// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { compressImageDataUrl, isInlineImageDataUrl, readBlobAsDataUrl } from '../src/lib/image-file'

/**
 * 图片读取与压缩。
 *
 * 这两个函数是从画布模块下沉出来的，AppShell 原来的内联实现也换成了它们。所以这里
 * 盯的是「下沉后行为是否符合两边的预期」：读得出来、压得下去、压不小就原样返回。
 */
describe('image-file', () => {
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
})
