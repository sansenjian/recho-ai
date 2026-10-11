import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * 评价提交的两个边界：未登录不得留下乐观状态、并发点击不得错误回滚。
 * 直接驱动 composable，避免把逻辑抄一份到测试里。
 */
function stubAuth(token: string | null) {
  vi.doMock('../src/composables/useAuthSession', () => ({
    getAuthAccessToken: async () => token,
  }))
  vi.doMock('../src/lib/api-base', () => ({
    apiUrl: (path: string) => `http://localhost${path}`,
  }))
}

describe('useMessageFeedback', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../src/composables/useAuthSession'); vi.doUnmock('../src/lib/api-base') })

  it('does not report success when there is no token', async () => {
    // 访客也能进工作台。没有 token 时若返回成功，界面会停在一个从未存进服务端的状态。
    stubAuth(null)
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => { calls.push('fetch'); return new Response('{}', { status: 200 }) }))
    const { useMessageFeedback } = await import('../src/composables/useMessageFeedback')
    const feedback = useMessageFeedback('chat')

    const ok = await feedback.submit('m1', 1)
    expect(ok).toBe(false)
    // 未登录不该发请求，也不该在本地留下「已好评」。
    expect(calls).toHaveLength(0)
    expect(feedback.values.value.m1).toBeUndefined()
  })

  it('rolls back on a failed request', async () => {
    stubAuth('token')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const { useMessageFeedback } = await import('../src/composables/useMessageFeedback')
    const feedback = useMessageFeedback('chat')

    const ok = await feedback.submit('m1', 1)
    expect(ok).toBe(false)
    expect(feedback.values.value.m1).toBeUndefined()
  })

  it('keeps the newest intent when a stale request fails', async () => {
    // 连点好评再点差评会并发出两个请求；第一个失败时不能用旧值覆盖第二个的乐观值。
    stubAuth('token')
    let resolveFirst: (() => void) | null = null
    const first = new Promise<void>(resolve => { resolveFirst = resolve })
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) { await first; return new Response('nope', { status: 500 }) }
      return new Response('{}', { status: 200 })
    }))

    const { useMessageFeedback } = await import('../src/composables/useMessageFeedback')
    const feedback = useMessageFeedback('chat')

    const a = feedback.submit('m1', 1)
    const b = feedback.submit('m1', -1)
    resolveFirst!()
    await Promise.all([a, b])
    // 后一次点击的意图必须保留。
    expect(feedback.values.value.m1).toBe(-1)
  })

  it('queries by repeated keys so a key containing a comma still resolves', async () => {
    stubAuth('token')
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(String(url)); return new Response('{"feedback":{}}', { status: 200 }) }))
    const { useMessageFeedback } = await import('../src/composables/useMessageFeedback')
    const feedback = useMessageFeedback('chat')

    await feedback.load(['a,b', 'c'])
    expect(urls[0]).toContain('keys=a%2Cb')
    expect(urls[0]).toContain('keys=c')
    expect(urls[0]).not.toContain('keys=a,b')
  })
})
