// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * jsdom 的 Response 不保留二进制 body 的类型与长度（空 body 会变成 13 字节的
 * text/plain），所以这里直接给出一个形如 Response 的对象，让被测代码走它自己的
 * 分支，而不是依赖 jsdom 的实现细节。
 */
function fakeResponse(bytes: Uint8Array, type = 'image/png', status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob([bytes], { type }),
  }
}

describe('fetchAuthenticatedImageBlob', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns the image bytes for the clipboard to take', async () => {
    fetchMock.mockResolvedValue(fakeResponse(PNG_BYTES))
    const { fetchAuthenticatedImageBlob } = await import('../src/lib/authenticated-image-source')
    const blob = await fetchAuthenticatedImageBlob('supabase://a.png')
    expect(blob.size).toBe(PNG_BYTES.length)
  })

  it('goes through the authenticated storage proxy, not a public URL', async () => {
    fetchMock.mockResolvedValue(fakeResponse(PNG_BYTES))
    const { fetchAuthenticatedImageBlob } = await import('../src/lib/authenticated-image-source')
    await fetchAuthenticatedImageBlob('supabase://a.png')
    const [url] = fetchMock.mock.calls[0]
    // 私有图走公开地址只会拿到 401，复制到的就是错误页。
    expect(String(url)).toContain('/api/image/storage/')
    expect(String(url)).not.toContain('supabase://')
  })

  it('throws instead of handing an empty image to the clipboard', async () => {
    fetchMock.mockResolvedValue(fakeResponse(new Uint8Array([])))
    const { fetchAuthenticatedImageBlob } = await import('../src/lib/authenticated-image-source')
    await expect(fetchAuthenticatedImageBlob('supabase://a.png')).rejects.toThrow(/empty/)
  })

  it('surfaces a failed proxy response instead of copying nothing', async () => {
    fetchMock.mockResolvedValue(fakeResponse(new Uint8Array([]), 'text/plain', 403))
    const { fetchAuthenticatedImageBlob } = await import('../src/lib/authenticated-image-source')
    await expect(fetchAuthenticatedImageBlob('supabase://a.png')).rejects.toThrow(/403/)
  })
})
