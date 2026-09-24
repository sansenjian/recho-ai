import {
  CLIError,
  EXIT_BUSINESS,
  EXIT_GENERIC,
  EXIT_UNAUTHORIZED,
  EXIT_UNREACHABLE,
  type ChatMessage,
  type ChatStreamEvent,
  type ChatStreamResult,
} from './types.js'
import { consumeSseStream, parseSseJson, sseUnexpectedEnd } from './sse.js'

export interface RequestOptions {
  method?: 'GET' | 'POST'
  path: string
  baseUrl: string
  token?: string | null
  body?: unknown
  headers?: Record<string, string>
}

/** 归一化底层 fetch / HTTP 状态码为 CLIError。 */
export function toCLIErrorFromFetch(err: unknown): CLIError {
  if (err instanceof CLIError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (
    /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|socket hang up|network/i.test(
      message,
    )
  ) {
    return new CLIError(EXIT_UNREACHABLE, 'UNREACHABLE', `无法连接站点: ${message}`)
  }
  return new CLIError(EXIT_GENERIC, 'NETWORK', message)
}

/** 将非 2xx 的 HTTP 响应转化为 CLIError(优先读取 JSON 的 error 字段)。 */
export async function toCLIErrorFromResponse(res: Response): Promise<CLIError> {
  let message = res.statusText || res.status.toString()
  try {
    const data = (await res.json()) as { error?: string | { message?: string } }
    const err = data?.error
    if (typeof err === 'string' && err) message = err
    else if (err && typeof err === 'object' && typeof err.message === 'string' && err.message) message = err.message
  } catch {
    // 非 JSON 响应,保留 statusText
  }
  const unauthorized = res.status === 401 || res.status === 403
  const exitCode = unauthorized ? EXIT_UNAUTHORIZED : res.status >= 400 && res.status < 500 ? EXIT_BUSINESS : EXIT_GENERIC
  const code = unauthorized ? 'UNAUTHORIZED' : 'API_ERROR'
  const suffix = unauthorized ? '（请确认 token 有效，可重新运行 `recho login`）' : ''
  return new CLIError(exitCode, code, `站点返回 ${res.status}: ${message}${suffix}`)
}

/** 通用 JSON API 调用。 */
export async function apiJson<T>(opts: RequestOptions): Promise<T> {
  const url = `${opts.baseUrl}${opts.path}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers ?? {}),
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (err) {
    throw toCLIErrorFromFetch(err)
  }
  if (res.ok) {
    if (res.status === 204) return undefined as T
    // baseUrl 可能指向前端 SPA 或反向代理，2xx 也可能返回 HTML。
    // 直接 res.json() 抛 SyntaxError 会归一为 UNEXPECTED，用户无法定位配置错误。
    const text = await res.text()
    try {
      return JSON.parse(text) as T
    } catch {
      throw new CLIError(
        EXIT_GENERIC,
        'BAD_RESPONSE',
        `站点返回的不是 JSON（${res.headers.get('content-type') ?? 'unknown'}），请确认 --base-url 指向 API 站点。`,
      )
    }
  }
  throw await toCLIErrorFromResponse(res)
}

export interface StreamChatOptions {
  baseUrl: string
  token: string
  model: string
  messages: ChatMessage[]
  skill?: string
  onEvent?: (event: ChatStreamEvent) => void
}

/** 调用 /api/chat 并消费 SSE 流,累积 content/thinking 与完整事件列表。 */
export async function streamChat(opts: StreamChatOptions): Promise<ChatStreamResult> {
  const events: ChatStreamEvent[] = []
  let content = ''
  let thinking = ''
  let finishReason: string | undefined
  let streamError: string | null = null
  let sawTerminalEvent = false

  let res: Response
  try {
    res = await fetch(`${opts.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        ...(opts.skill ? { skill: opts.skill } : {}),
      }),
    })
  } catch (err) {
    throw toCLIErrorFromFetch(err)
  }
  if (!res.ok) throw await toCLIErrorFromResponse(res)
  if (!res.body) throw new CLIError(EXIT_GENERIC, 'NO_BODY', '站点未返回流式响应体。')

  try {
    await consumeSseStream(res.body, (msg) => {
      if (msg.event === 'error') {
        const parsed = parseSseJson(msg.data)
        const message =
          typeof parsed?.error === 'string' ? parsed.error : typeof parsed?.message === 'string' ? parsed.message : msg.data
        streamError = streamError ?? message
        return
      }
      if (msg.data === '[DONE]') {
        sawTerminalEvent = true
        return
      }
      const data = parseSseJson(msg.data)
      if (!data) return
      events.push(data as ChatStreamEvent)
      switch (data.type) {
        case 'content_delta':
          if (typeof data.text === 'string') content += data.text
          break
        case 'thinking_delta':
          if (typeof data.text === 'string') thinking += data.text
          break
        case 'message_complete':
          sawTerminalEvent = true
          if (typeof data.finishReason === 'string') finishReason = data.finishReason
          if (data.finishReason === 'error') streamError = streamError ?? '响应中途失败。'
          break
      }
      opts.onEvent?.(data as ChatStreamEvent)
    })
  } catch (err) {
    throw toCLIErrorFromFetch(err)
  }

  if (streamError) {
    throw new CLIError(EXIT_BUSINESS, 'STREAM_ERROR', streamError)
  }
  // SSE 正常关闭但从未收到终止事件（message_complete / [DONE]）：流不完整，拒绝返回部分结果。
  if (!sawTerminalEvent) throw sseUnexpectedEnd()
  return { content, thinking, finishReason, events }
}