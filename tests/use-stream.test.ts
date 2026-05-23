import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../src/types/events'

const workerMock = vi.hoisted(() => {
  class MockSSEWorker {
    onmessage: ((event: MessageEvent<{ type: string; content?: string }>) => void) | null = null

    postMessage(message: { type: string; data?: ArrayBuffer }) {
      if (message.type === 'chunk' && message.data) {
        const content = new TextDecoder().decode(message.data)
        this.onmessage?.({ data: { type: 'delta', content } } as MessageEvent<{ type: string; content: string }>)
      }
      if (message.type === 'flush') {
        this.onmessage?.({ data: { type: 'done' } } as MessageEvent<{ type: string }>)
      }
    }

    terminate() {}
  }

  return { MockSSEWorker }
})

vi.mock('../src/workers/sse-parser.worker?worker', () => ({
  default: workerMock.MockSSEWorker,
}))

import { useStream } from '../src/composables/useStream'

function mockStreamingResponse(body: ReadableStream<Uint8Array>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
}

describe('useStream', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('refreshes the idle timeout when slow streams keep sending chunks', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const chunks: string[] = []
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]

    mockStreamingResponse(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('first'))
        window.setTimeout(() => controller.enqueue(encoder.encode('second')), 80_000)
        window.setTimeout(() => controller.close(), 100_000)
      },
    }))

    const { streamChat } = useStream()
    const result = streamChat(messages, {
      onDelta: content => chunks.push(content),
      onToolCall: () => {},
      onToolResult: () => {},
      onToolEnd: () => {},
    }).then(
      () => ({ status: 'resolved' as const }),
      error => ({ status: 'rejected' as const, error }),
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(chunks).toEqual(['first'])

    await vi.advanceTimersByTimeAsync(80_000)
    expect(chunks).toEqual(['first', 'second'])

    await vi.advanceTimersByTimeAsync(20_000)
    expect(await result).toEqual({ status: 'resolved' })
  })

  it('rejects when the stream stops sending data before finishing', async () => {
    vi.useFakeTimers()
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]

    mockStreamingResponse(new ReadableStream<Uint8Array>({ start() {} }))

    const { streamChat, isStreaming } = useStream()
    const result = streamChat(messages, {
      onDelta: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onToolEnd: () => {},
    }).then(
      () => ({ status: 'resolved' as const }),
      error => ({ status: 'rejected' as const, message: error.message }),
    )

    await vi.advanceTimersByTimeAsync(90_000)

    expect(await result).toEqual({ status: 'rejected', message: 'stream idle timeout' })
    expect(isStreaming.value).toBe(false)
  })
})
