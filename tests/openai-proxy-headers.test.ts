import { describe, expect, it } from 'vitest'
import type { Request } from 'express'
import { requestHeaders } from '../backend/gateway/src/routes/openai-proxy'

// 逐跳头不能转发到下一跳：undici 对 transfer-encoding、keep-alive 这类头会直接
// 抛 TypeError，代理只能回 502。外部 OpenAI 客户端常用 chunked 上传大图，
// 不剥离就会踩到。
function fakeRequest(headers: Record<string, string>): Request {
  return { headers } as unknown as Request
}

describe('openai proxy request headers', () => {
  it('strips connection, host and content-length', () => {
    const headers = requestHeaders(fakeRequest({
      host: 'api.example.test',
      connection: 'keep-alive',
      'content-length': '123',
      authorization: 'Bearer rk-test',
    }))

    expect(headers.get('host')).toBeNull()
    expect(headers.get('connection')).toBeNull()
    expect(headers.get('content-length')).toBeNull()
    expect(headers.get('authorization')).toBe('Bearer rk-test')
  })

  it('strips the remaining hop-by-hop headers that fetch refuses to send', () => {
    const headers = requestHeaders(fakeRequest({
      'transfer-encoding': 'chunked',
      'keep-alive': 'timeout=5',
      te: 'trailers',
      trailer: 'x-checksum',
      upgrade: 'websocket',
      'proxy-connection': 'keep-alive',
      'proxy-authorization': 'Basic xyz',
      'proxy-authenticate': 'Basic',
      'content-type': 'application/json',
    }))

    for (const name of ['transfer-encoding', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate']) {
      expect(headers.get(name), name).toBeNull()
    }
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('strips headers nominated by the Connection header', () => {
    // Connection: x-custom 表示 x-custom 是逐跳头，同样不能转发。
    const headers = requestHeaders(fakeRequest({
      connection: 'x-custom, x-another',
      'x-custom': 'secret',
      'x-another': 'also-secret',
      'x-keep': 'kept',
    }))

    expect(headers.get('x-custom')).toBeNull()
    expect(headers.get('x-another')).toBeNull()
    expect(headers.get('x-keep')).toBe('kept')
  })

  it('preserves end-to-end headers including authorization and idempotency keys', () => {
    const headers = requestHeaders(fakeRequest({
      authorization: 'Bearer rk-test',
      'content-type': 'application/json',
      'idempotency-key': 'abc-123',
      'x-request-id': 'req-1',
    }))

    expect(headers.get('authorization')).toBe('Bearer rk-test')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('idempotency-key')).toBe('abc-123')
    expect(headers.get('x-request-id')).toBe('req-1')
  })
})
