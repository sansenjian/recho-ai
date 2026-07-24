import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/composables/useAuthSession', () => ({
  getAuthAccessToken: vi.fn(async () => 'admin-token'),
}))

vi.mock('../src/lib/api-base', () => ({
  apiUrl: (path: string) => `http://localhost${path}`,
}))

import { adminApiJson } from '../src/composables/useAdminApi'

describe('adminApiJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('adds the admin bearer token and JSON content type', async () => {
    await expect(adminApiJson('/api/admin/test', {
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    })).resolves.toEqual({ ok: true })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer admin-token')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('propagates caller cancellation to fetch', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason)
        return
      }
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })))
    const controller = new AbortController()
    const request = adminApiJson('/api/admin/test', { signal: controller.signal })

    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
  })

  it('uses the request timeout signal', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')))

    await expect(adminApiJson('/api/admin/test')).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
