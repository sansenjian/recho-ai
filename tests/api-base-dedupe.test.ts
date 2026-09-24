// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../src/lib/api-base'

describe('apiFetch in-flight deduplication', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dedupes concurrent idempotent GET requests into a single fetch', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const url = '/api/config/app'
    const [a, b, c] = await Promise.all([apiFetch(url), apiFetch(url), apiFetch(url)])
    const bodies = await Promise.all([a.json(), b.json(), c.json()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies).toEqual([{ ok: true }, { ok: true }, { ok: true }])
  })

  it('does not dedupe requests that opt out with cache: no-store', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ n: 1 }), { status: 200 }))

    await Promise.all([
      apiFetch('/api/image/history?offset=0', { cache: 'no-store' }),
      apiFetch('/api/image/history?offset=0', { cache: 'no-store' }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not dedupe requests with non-default cache modes (reload/force-cache)', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ n: 1 }), { status: 200 }))

    await Promise.all([
      apiFetch('/api/config/app', { cache: 'reload' }),
      apiFetch('/api/config/app', { cache: 'force-cache' }),
      apiFetch('/api/config/app', { cache: 'no-cache' }),
    ])

    // reload/force-cache/no-cache 对缓存行为有显式要求，不能与默认请求共享同一支 in-flight。
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not dedupe non-idempotent methods or body-carrying requests', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ n: 1 }), { status: 200 }))

    await Promise.all([
      apiFetch('/api/credits/redeem', { method: 'POST' }),
      apiFetch('/api/image/generate', { method: 'POST', body: JSON.stringify({ p: 'x' }) }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('dedupe key distinguishes URLs', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ n: 1 }), { status: 200 }))

    await Promise.all([
      apiFetch('/api/image/history?offset=0'),
      apiFetch('/api/image/history?offset=12'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborting the caller aborts only that caller, leaving the shared request intact', async () => {
    const fetchMock = vi.mocked(fetch)
    let resolveFetch: (r: Response) => void = () => {}
    fetchMock.mockImplementation((_url, init) => new Promise<Response>((resolve, reject) => {
      resolveFetch = resolve
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    }))

    const controllerA = new AbortController()
    const controllerB = new AbortController()

    const aPromise = apiFetch('/api/config/app', { signal: controllerA.signal })
    const bPromise = apiFetch('/api/config/app', { signal: controllerB.signal })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 第一个调用方 abort：共享的底层 fetch 用的是内部 controller，
    // 不应被 caller A 的 signal 影响，B 仍能拿到完整响应。
    controllerA.abort()
    await expect(aPromise).rejects.toMatchObject({ name: 'AbortError' })

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const bResponse = await bPromise
    await expect(bResponse.json()).resolves.toEqual({ ok: true })
  })

  it('skips dedupe when the request carries headers (identity-specific)', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await Promise.all([
      apiFetch('/api/config/app', { headers: { Authorization: 'Bearer token-a' } }),
      apiFetch('/api/config/app', { headers: { Authorization: 'Bearer token-b' } }),
    ])

    // 带 Authentication 的请求不进去重路径，各自独立发起，避免串数据。
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('materializes null-body statuses (204/304) without throwing', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))

    const responses = await Promise.all([
      apiFetch('/api/no-content'),
      apiFetch('/api/no-content'),
    ])
    for (const res of responses) {
      expect(res.status).toBe(204)
      await expect(res.text()).resolves.toBe('')
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('releases the shared entry after all callers settle', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await Promise.all([apiFetch('/api/skills'), apiFetch('/api/skills')])
    // 同一 key 上一批已结束，新一批应再次发起 fetch（而非被陈旧缓存命中）。
    await apiFetch('/api/skills')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})