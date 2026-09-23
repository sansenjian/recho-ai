import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { CLIError, EXIT_GENERIC } from './types.js'

/**
 * eventsource-parser 的薄封装:将 Response body 流按块喂给 parser,
 * 每个解析出的 SSE 消息(含命名的 event 与默认 message)通过 handler 回调。
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: EventSourceMessage) => void,
): Promise<void> {
  const parser = createParser({ onEvent })
  const reader = body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
  } finally {
    reader.releaseLock()
  }
}

/** 解析 SSE 事件中的 JSON 数据;失败返回 null(如 [DONE])。 */
export function parseSseJson(data: string): Record<string, unknown> | null {
  if (!data.length || data === '[DONE]') return null
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 期望收到消息,实际断流的保护性错误。 */
export function sseUnexpectedEnd(): CLIError {
  return new CLIError(EXIT_GENERIC, 'STREAM_ENDED', '流式响应意外结束。')
}