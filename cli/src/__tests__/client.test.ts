import { describe, it, expect, afterEach, vi } from 'vitest'
import { apiJson, streamChat } from '../client.js'
import { CLIError } from '../types.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 用分块 SSE 数据构造流式响应。 */
function sseResponse(chunks: string[], opts: { status?: number; body?: unknown } = {}): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, {
    status: opts.status ?? 200,
    ...(opts.body !== undefined
      ? { headers: { 'Content-Type': 'application/json' } }
      : { headers: { 'Content-Type': 'text/event-stream' } }),
  })
}

describe('apiJson', () => {
  it('解析成功响应', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ balance: 12.5 })))
    const data = await apiJson<{ balance: number }>({ path: '/api/credits', baseUrl: 'https://x.com', token: 't' })
    expect(data.balance).toBe(12.5)
    expect(fetch).toHaveBeenCalledWith(
      'https://x.com/api/credits',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer t' }) }),
    )
  })

  it('401 归一为退出码 4', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))
    await expect(apiJson({ path: '/api/credits', baseUrl: 'https://x.com', token: 'bad' })).rejects.toMatchObject({
      exitCode: 4,
      code: 'UNAUTHORIZED',
    })
  })

  it('业务错误 402 归一为退出码 6', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: '额度不足' }, 402)))
    await expect(apiJson({ path: '/api/credits', baseUrl: 'https://x.com', token: 't' })).rejects.toMatchObject({
      exitCode: 6,
    })
  })

  it('网络错误归一为退出码 5', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed, ECONNREFUSED')))
    await expect(apiJson({ path: '/x', baseUrl: 'https://x.com' })).rejects.toMatchObject({ exitCode: 5 })
  })

  it('2xx 但返回 HTML 时归一为 BAD_RESPONSE 而非 UNEXPECTED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html>SPA</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    )
    await expect(apiJson({ path: '/api/config/app', baseUrl: 'https://spa.example.com' })).rejects.toMatchObject({
      exitCode: 1,
      code: 'BAD_RESPONSE',
    })
  })
})

describe('streamChat', () => {
  const chunks = [
    'data: {"type":"content_delta","blockId":"b1","text":"你好"}\n\n',
    'data: {"type":"thinking_delta","text":"思考中"}\n\n',
    'data: {"type":"content_delta","blockId":"b1","text":"世界"}\n\n',
    'data: {"type":"message_complete","finishReason":"stop","incomplete":false}\n\n',
    'data: [DONE]\n\n',
  ]

  it('累积 content 与 thinking,并收集事件列表', async () => {
    const onEvent = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(chunks)))
    const result = await streamChat({
      baseUrl: 'https://x.com',
      token: 't',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      onEvent,
    })
    expect(result.content).toBe('你好世界')
    expect(result.thinking).toBe('思考中')
    expect(result.finishReason).toBe('stop')
    expect(result.events).toHaveLength(4)
    expect(onEvent).toHaveBeenCalledTimes(4)
  })

  it('错误事件(exit 6)', async () => {
    const errorChunks = [
      'event: error\ndata: {"error":"额度不足"}\n\n',
      'data: [DONE]\n\n',
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(errorChunks)))
    await expect(
      streamChat({ baseUrl: 'https://x.com', token: 't', model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ exitCode: 6, code: 'STREAM_ERROR', message: '额度不足' })
  })

  it('message_complete 标记 error 同样抛出业务错误', async () => {
    const chunks = [
      'data: {"type":"message_complete","finishReason":"error","incomplete":true}\n\n',
      'data: [DONE]\n\n',
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(chunks)))
    await expect(
      streamChat({ baseUrl: 'https://x.com', token: 't', model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ exitCode: 6 })
  })

  it('非 2xx 直接归一化错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: '请先登录' }, 403)))
    await expect(
      streamChat({ baseUrl: 'https://x.com', token: 't', model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(CLIError)
  })

  it('按 server 拆分跨越块边界的 SSE 也能正确拼接', async () => {
    const half = 'data: {"type":"content_delta","blockId":"b1","text":"一半"}'
    const odd = sseResponse([half.slice(0, 30), half.slice(30) + '\n\n', 'data: [DONE]\n\n'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(odd))
    const result = await streamChat({ baseUrl: 'https://x.com', token: 't', model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(result.content).toBe('一半')
  })

  it('流在收到终止事件前提前结束则抛 STREAM_ENDED', async () => {
    const truncated = sseResponse(['data: {"type":"thinking_delta","text":"思考中"}\n\n'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(truncated))
    await expect(
      streamChat({ baseUrl: 'https://x.com', token: 't', model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ exitCode: 1, code: 'STREAM_ENDED' })
  })
})