import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getGoSidecarHealth,
  resetGoSidecarHealthCache,
} from '../backend/gateway/src/services/go-sidecar-health'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  resetGoSidecarHealthCache()
})

describe('go sidecar health', () => {
  it('reports an unavailable configured sidecar as not ready', async () => {
    vi.stubEnv('GO_GATEWAY_BASE_URL', 'http://127.0.0.1:3001')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))

    await expect(getGoSidecarHealth()).resolves.toMatchObject({
      configured: true,
      ready: false,
      error: 'Go gateway returned 503',
    })
  })

  it('does not require a sidecar when the proxy is disabled', async () => {
    vi.stubEnv('GO_GATEWAY_BASE_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getGoSidecarHealth()).resolves.toMatchObject({ configured: false, ready: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent sidecar checks', async () => {
    vi.stubEnv('GO_GATEWAY_BASE_URL', 'http://127.0.0.1:3001')
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const firstCheck = getGoSidecarHealth()
    const secondCheck = getGoSidecarHealth()

    expect(fetchMock).toHaveBeenCalledOnce()
    resolveFetch(new Response('ready'))
    const [first, second] = await Promise.all([firstCheck, secondCheck])

    expect(second).toBe(first)
  })

  it('reuses a completed check from cache and cancels its response body', async () => {
    vi.stubEnv('GO_GATEWAY_BASE_URL', 'http://127.0.0.1:3001')
    const response = new Response('ready')
    const cancelSpy = vi.spyOn(response.body!, 'cancel')
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    const first = await getGoSidecarHealth()
    const second = await getGoSidecarHealth()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancelSpy).toHaveBeenCalledOnce()
    expect(second).toBe(first)
  })
})
