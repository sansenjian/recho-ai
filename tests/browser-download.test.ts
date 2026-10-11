// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { saveImageBlob, triggerFileDownload } from '../src/lib/browser-download'
import type { GeneratedImage } from '../src/types/image'

function img(prompt = 'a dot'): GeneratedImage {
  return { id: 'i1', prompt, userPrompt: prompt, size: '1024x1024', timestamp: '2026-01-01T00:00:00.000Z' }
}

describe('triggerFileDownload', () => {
  let clicked: Array<{ href: string; download: string }> = []

  beforeEach(() => {
    clicked = []
    const real = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = real(tag)
      if (tag === 'a') {
        const a = el as HTMLAnchorElement
        Object.defineProperty(a, 'click', { value: () => clicked.push({ href: a.href, download: a.download }) })
      }
      return el
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('clicks an anchor carrying the href and file name', () => {
    triggerFileDownload('blob:fake', 'a.png')
    expect(clicked).toEqual([{ href: 'blob:fake', download: 'a.png' }])
  })

  it('does not leave the anchor in the document', () => {
    // 漏掉移除就会在 DOM 里堆节点，长会话下越积越多。
    const before = document.body.querySelectorAll('a').length
    triggerFileDownload('blob:fake', 'a.png')
    expect(document.body.querySelectorAll('a').length).toBe(before)
  })
})

describe('saveImageBlob', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:object')
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('names the file after the blob mime type, not a fixed .png', () => {
    // 存储代理可能返回 webp；写死 .png 会让后缀和内容对不上。
    const anchorSpy = vi.spyOn(document, 'createElement')
    saveImageBlob(new Blob(['x'], { type: 'image/webp' }), img())
    const anchor = anchorSpy.mock.results.map(r => r.value).find((el: HTMLElement) => el.tagName === 'A') as HTMLAnchorElement
    expect(anchor.download).toBe('a_dot.webp')
  })

  it('revokes the object url later instead of immediately', () => {
    // 立刻 revoke 会让浏览器读不完文件，下载中断。
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    saveImageBlob(new Blob(['x'], { type: 'image/png' }), img())
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(revoke).toHaveBeenCalledWith('blob:object')
  })
})
