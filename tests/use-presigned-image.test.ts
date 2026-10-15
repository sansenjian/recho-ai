// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getToken = vi.fn()
vi.mock('../src/composables/useAuthSession', () => ({
  getAuthAccessToken: () => getToken(),
  getAuthIdentity: async () => ({ accessToken: null, userId: null }),
}))

describe('usePresignedImage', () => {
  beforeEach(() => {
    vi.resetModules()
    getToken.mockReset()
    vi.unstubAllGlobals()
  })

  it('returns empty when reading the token throws', async () => {
    // 取 token 会走一次会话读取，它抛错时不该把异常抛给调用方：调用方的 watch 回调
    // 会半途中断，连代理回落都不执行，图片就完全不显示了。
    getToken.mockRejectedValue(new Error('session read failed'))
    const { requestPresignedImageUrl } = await import('../src/composables/usePresignedImage')

    await expect(requestPresignedImageUrl('cos://x.webp')).resolves.toBeNull()
  })

  it('returns empty when the request fails', async () => {
    getToken.mockResolvedValue('token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const { requestPresignedImageUrl } = await import('../src/composables/usePresignedImage')

    await expect(requestPresignedImageUrl('cos://x.webp')).resolves.toBeNull()
  })

  it('maps a successful response by path', async () => {
    getToken.mockResolvedValue('token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ path: 'cos://x.webp', url: 'https://cos.example/signed', expiresAt: 123 }] }),
    }))
    const { requestPresignedImageUrl } = await import('../src/composables/usePresignedImage')

    const signed = await requestPresignedImageUrl('cos://x.webp')
    expect(signed).toEqual({ url: 'https://cos.example/signed', expiresAt: 123 })
  })

  it('drops paths that came back with an error', async () => {
    // forbidden / unsupported 都不带 url，调用方据此回落代理。
    getToken.mockResolvedValue('token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ path: 'cos://x.webp', error: 'forbidden' }] }),
    }))
    const { requestPresignedImageUrl } = await import('../src/composables/usePresignedImage')

    await expect(requestPresignedImageUrl('cos://x.webp')).resolves.toBeNull()
  })
})
