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
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))

    const controllerA = new AbortController()
    const controllerB = new AbortController()

    const aPromise = apiFetch('/api/config/app', { signal: controllerA.signal })
    const bPromise = apiFetch('/api/config/app', { signal: controllerB.signal })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    controllerA.abort()
    await expect(aPromise).rejects.toMatchObject({ name: 'AbortError' })

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const bResponse = await bPromise
    await expect(bResponse.json()).resolves.toEqual({ ok: true })
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