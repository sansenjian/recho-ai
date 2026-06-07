import { afterEach, describe, expect, it, vi } from 'vitest'
import { looksAbrupt, runTAORLoop } from '../backend/gateway/src/services/chat-loop'
import { mcpManager } from '../backend/gateway/src/mcp/manager'

function streamFrom(chunks: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function createClient(streams: unknown[]) {
  let index = 0
  return {
    chat: {
      completions: {
        create: vi.fn(async () => streams[index++]),
      },
    },
  } as any
}

function createSseResponse() {
  const writes: string[] = []
  return {
    writableEnded: false,
    destroyed: false,
    write(chunk: string) {
      writes.push(chunk)
      return true
    },
    end() {
      this.writableEnded = true
    },
    once: vi.fn(),
    off: vi.fn(),
    writes,
  } as any
}

function parseSsePayloads(writes: string[]) {
  return writes
    .flatMap(chunk => chunk.split('\n\n'))
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.startsWith('data: ') && chunk !== 'data: [DONE]')
    .map(chunk => JSON.parse(chunk.slice('data: '.length)))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gateway chat loop', () => {
  it('treats unfinished markdown emphasis as an abrupt answer', () => {
    expect(looksAbrupt('高性价比之选\n\n| 型号 | 定位 |\n| --- | --- |\n| **OnePlus Bud')).toBe(true)
  })

  it('does not treat complete Chinese prose as abrupt', () => {
    expect(looksAbrupt('这是一个完整的回答，最后给出清晰建议。')).toBe(false)
  })

  it('does not treat a complete recommendation line without punctuation as abrupt', () => {
    expect(looksAbrupt([
      '下面是一些推荐。',
      '',
      '1. 头戴式耳机',
      '',
      '**Sony WH-1000XM6**',
      '- 降噪强',
      '- 续航稳定',
      '',
      '综合首选：Sony WH-1000XM6',
    ].join('\n'))).toBe(false)
  })

  it('emits terminal error events when a tool call fails', async () => {
    vi.spyOn(mcpManager, 'executeTool').mockRejectedValueOnce(new Error('network failed'))
    const client = createClient([
      streamFrom([
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call-1',
                function: { name: 'tavily_search', arguments: '{"query":"vue"}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        },
      ]),
      streamFrom([
        { choices: [{ delta: { content: '工具失败后继续回答' }, finish_reason: 'stop' }] },
      ]),
    ])
    const res = createSseResponse()

    await runTAORLoop(
      client,
      'test-model',
      [{ role: 'user', content: 'search vue' }],
      [{ type: 'function', function: { name: 'tavily_search', description: '', parameters: {} } }],
      res,
    )

    expect(parseSsePayloads(res.writes)).toEqual([
      { type: 'status', state: 'thinking', label: '准备生成回复' },
      { type: 'tool_call', id: 'call-1', name: 'tavily_search', arguments: { query: 'vue' }, status: 'running' },
      { type: 'status', state: 'tool_executing', label: '运行云端工具 tavily_search' },
      { type: 'tool_result', id: 'call-1', name: 'tavily_search', result: 'Error: 工具执行失败，请稍后重试。', isError: true },
      { type: 'tool_end', id: 'call-1', status: 'error' },
      { type: 'status', state: 'thinking', label: '准备生成回复' },
      { type: 'content_start', blockType: 'text', blockId: expect.any(String) },
      { type: 'content_delta', blockId: expect.any(String), text: '工具失败后继续回答' },
      { type: 'message_complete', finishReason: 'stop', incomplete: false },
      { type: 'status', state: 'idle', label: '完成' },
    ])
  })

  it('closes the stream with an error when the model stream does not start', async () => {
    vi.useFakeTimers()
    const client = {
      chat: {
        completions: {
          create: vi.fn(() => new Promise(() => {})),
        },
      },
    } as any
    const res = createSseResponse()

    const run = runTAORLoop(
      client,
      'test-model',
      [{ role: 'user', content: 'hi' }],
      [],
      res,
    )

    await vi.advanceTimersByTimeAsync(15_000)
    await run
    vi.useRealTimers()

    expect(parseSsePayloads(res.writes)).toEqual([
      { type: 'status', state: 'thinking', label: '准备生成回复' },
      { type: 'message_complete', finishReason: 'error', incomplete: true },
      { type: 'status', state: 'idle', label: '失败' },
      { type: 'error', error: '服务响应超时，请稍后重试。' },
    ])
    expect(res.writableEnded).toBe(true)
  })
})
