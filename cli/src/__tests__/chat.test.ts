import { describe, it, expect, afterEach, vi } from 'vitest'
import { chat } from '../commands/chat.js'
import type { InputStreamLike } from '../types.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fakeStdin(chunks: string[]): InputStreamLike {
  async function* gen(): AsyncGenerator<Buffer> {
    for (const chunk of chunks) yield Buffer.from(chunk)
  }
  return { isTTY: false, [Symbol.asyncIterator]: () => gen() }
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const SSE_SAMPLE = [
  'data: {"type":"content_delta","blockId":"b1","text":"你好"}\n\n',
  'data: {"type":"message_complete","finishReason":"stop","incomplete":false}\n\n',
  'data: [DONE]\n\n',
]

describe('chat 命令', () => {
  it('无参数时从(非 TTY)stdin 读取多行内容作为 prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(SSE_SAMPLE))
    vi.stubGlobal('fetch', fetchMock)
    const written: string[] = []
    const stdout = { write: (chunk: string) => void written.push(chunk) }

    await chat({
      prompt: undefined,
      model: 'gpt-4o',
      json: false,
      verbose: false,
      baseUrl: 'https://x.com',
      token: 't',
      stdin: fakeStdin(['第一行\n', '第二行']),
      stdout,
      isTTYOverride: false,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x.com/api/chat')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('gpt-4o')
    expect(body.messages).toEqual([{ role: 'user', content: '第一行\n第二行' }])
    expect(init.headers).toMatchObject({ Authorization: 'Bearer t' })
    expect(written.join('')).toContain('你好')
  })

  it('传入参数时不读 stdin,并支持 --system 注入系统消息', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(SSE_SAMPLE))
    vi.stubGlobal('fetch', fetchMock)
    const readSpy = vi.spyOn(process.stdin, 'read') // 仅确认未触碰真实 stdin 的读取路径

    await chat({
      prompt: '直接问',
      model: 'gpt-4o',
      system: '你是助手',
      json: false,
      verbose: false,
      baseUrl: 'https://x.com',
      token: 't',
      stdin: fakeStdin(['不应该被读取']),
      stdout: { write: () => undefined },
      isTTYOverride: false,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '直接问' },
    ])
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('--json 时输出单个 JSON 对象(不污染 stdout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(SSE_SAMPLE)))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await chat({
      prompt: 'hi',
      model: 'gpt-4o',
      json: true,
      verbose: false,
      baseUrl: 'https://x.com',
      token: 't',
      isTTYOverride: false,
    })

    const printed = logSpy.mock.calls.map((call) => call[0] as string).join('\n')
    const parsed = JSON.parse(printed)
    expect(parsed.content).toBe('你好')
    expect(parsed.model).toBe('gpt-4o')
    expect(Array.isArray(parsed.events)).toBe(true)
  })

  it('无模型参数时回退到站点默认聊天模型', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ chatModels: [{ id: 'kimi-default', name: 'Kimi' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(sseResponse(SSE_SAMPLE))
    vi.stubGlobal('fetch', fetchMock)

    await chat({ prompt: 'hi', json: false, verbose: false, baseUrl: 'https://x.com', token: 't', isTTYOverride: false })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://x.com/api/config/app', expect.anything())
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).model).toBe('kimi-default')
  })
})