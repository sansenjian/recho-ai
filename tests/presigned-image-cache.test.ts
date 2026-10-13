// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 签名地址的缓存。
 *
 * 打开查看器、左右翻页都要签发一次地址。缓存命中与否直接决定用户等待时间，
 * 所以这里盯三件事：同一路径不重复签发、临期地址不再复用、身份变化后清空。
 *
 * 账号切换那条尤其重要：缓存键只有路径、不带账号，不清就会让上一个账号的私有
 * 图地址在有效期内继续可读。
 */

const fetchMock = vi.fn()

function presignResponse(path: string, url: string, expiresAt: number) {
  return {
    ok: true,
    json: async () => ({ items: [{ path, url, expiresAt }] }),
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

async function loadModule() {
  vi.resetModules()
  return import('../src/composables/usePresignedImage')
}

describe('usePresignedImage', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    // 未登录：签名请求不带 Authorization，但签发本身仍会发出。
    vi.doMock('../src/composables/useAuthSession', () => ({
      getAuthAccessToken: async () => '',
      getAuthIdentity: async () => ({ userId: '', accessToken: '' }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('../src/composables/useAuthSession')
  })

  it('signs once and reuses the cached url for the same path', async () => {
    fetchMock.mockResolvedValue(
      presignResponse('a/b.webp', 'https://storage.test/a/b.webp?sig=1', nowSeconds() + 3600),
    )
    const { requestPresignedImageUrl } = await loadModule()

    const first = await requestPresignedImageUrl('a/b.webp')
    const second = await requestPresignedImageUrl('a/b.webp')

    expect(first?.url).toBe('https://storage.test/a/b.webp?sig=1')
    expect(second?.url).toBe(first?.url)
    // 关键断言：第二次不该再打一次签发请求。
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('merges concurrent requests for the same path', async () => {
    fetchMock.mockResolvedValue(
      presignResponse('a/b.webp', 'https://storage.test/a/b.webp?sig=1', nowSeconds() + 3600),
    )
    const { requestPresignedImageUrl } = await loadModule()

    await Promise.all([
      requestPresignedImageUrl('a/b.webp'),
      requestPresignedImageUrl('a/b.webp'),
      requestPresignedImageUrl('a/b.webp'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-signs when the cached url is inside the safety window', async () => {
    // 4 分钟后就过期，落在 5 分钟安全窗内：不能复用。
    fetchMock.mockResolvedValue(
      presignResponse('a/b.webp', 'https://storage.test/a/b.webp?sig=1', nowSeconds() + 240),
    )
    const { requestPresignedImageUrl } = await loadModule()
    await requestPresignedImageUrl('a/b.webp')

    fetchMock.mockResolvedValue(
      presignResponse('a/b.webp', 'https://storage.test/a/b.webp?sig=2', nowSeconds() + 3600),
    )
    const again = await requestPresignedImageUrl('a/b.webp')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(again?.url).toContain('sig=2')
  })

  it('drops the cache when the identity changes', async () => {
    fetchMock.mockResolvedValue(
      presignResponse('private/x.webp', 'https://storage.test/private/x.webp?sig=1', nowSeconds() + 3600),
    )
    const { requestPresignedImageUrl, clearPresignedImageCache } = await loadModule()
    await requestPresignedImageUrl('private/x.webp')

    clearPresignedImageCache()

    fetchMock.mockResolvedValue(
      presignResponse('private/x.webp', 'https://storage.test/private/x.webp?sig=2', nowSeconds() + 3600),
    )
    const afterSwitch = await requestPresignedImageUrl('private/x.webp')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(afterSwitch?.url).toContain('sig=2')
  })

  it('does not cache a failed issue so the next attempt can retry', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const { requestPresignedImageUrl } = await loadModule()

    expect(await requestPresignedImageUrl('a/b.webp')).toBeNull()

    fetchMock.mockResolvedValueOnce(
      presignResponse('a/b.webp', 'https://storage.test/a/b.webp?sig=1', nowSeconds() + 3600),
    )
    const retry = await requestPresignedImageUrl('a/b.webp')

    expect(retry?.url).toContain('sig=1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache an issue without an expiry', async () => {
    // expiresAt 为 0 时无法判断何时失效，复用它可能拿到一个已经过期的地址。
    fetchMock.mockResolvedValue(
      presignResponse('a/b.webp', 'https://storage.test/a/b.webp?sig=1', 0),
    )
    const { requestPresignedImageUrl } = await loadModule()
    await requestPresignedImageUrl('a/b.webp')
    await requestPresignedImageUrl('a/b.webp')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not let an in-flight issue from the old identity refill the cache', async () => {
    // 竞态：旧账号的签发请求发出 → 用户登出/切号触发清理 → 响应才回来。
    // 如果这时还往 issued 里写，新账号请求同一路径就会拿到旧账号的地址。
    // 清 inFlight 只是让后来的调用不再复用那个 Promise，取消不了已发出的请求。
    let releaseOldRequest: (() => void) | null = null
    fetchMock.mockImplementationOnce(async (url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body || '{}')
      await new Promise<void>((resolve) => { releaseOldRequest = resolve })
      return {
        ok: true,
        json: async () => ({
          items: (body.paths || []).map((path: string) => ({
            path,
            url: 'https://storage.test/private/x.webp?sig=OLD',
            expiresAt: nowSeconds() + 3600,
          })),
        }),
      }
    })

    const { requestPresignedImageUrl, clearPresignedImageCache } = await loadModule()
    const oldRequest = requestPresignedImageUrl('private/x.webp')

    // fetch 之前还有一次 await getAuthAccessToken()，要让出几轮 microtask，
    // 请求才会真正落到 mock 里挂起——否则 clear 发生在请求发出之前，
    // 这条用例就绕开了它本该覆盖的竞态。
    while (!releaseOldRequest) await Promise.resolve()

    // 身份切换发生在旧请求返回之前。
    clearPresignedImageCache()
    releaseOldRequest()
    await oldRequest

    // 新身份请求同一路径：必须重新签发，不能命中旧身份的地址。
    fetchMock.mockResolvedValue(
      presignResponse('private/x.webp', 'https://storage.test/private/x.webp?sig=NEW', nowSeconds() + 3600),
    )
    const afterSwitch = await requestPresignedImageUrl('private/x.webp')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(afterSwitch?.url).toContain('sig=NEW')
  })
})
