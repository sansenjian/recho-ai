import { Router, Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { Agent, fetch } from 'undici'
import { safeErrorDetail } from '../services/safe-error.js'
import { apiErrorBody } from '../services/api-error.js'

// OpenAI 兼容端点（/v1/*）的反向代理。
//
// 独立于 /api 侧的 go-sidecar 路由，原因有两点：
//   1. 挂载前缀不同。go-sidecar 挂在 app.use('/api', ...)，其 requestUrl 会给
//      目标补 /api 前缀；而 /v1/* 转发到 Go 网关时路径原样保留。
//   2. 记录语义不同。image attempt 观测记录针对站内 /api/image/generate；
//      外部调用走的是 /v1，不应混入同一份站内统计。
//
// 超时与流式转发行为与站内代理保持一致，避免长耗时生图被缓冲成 504。

const router = Router()
const DEFAULT_PROXY_TIMEOUT_MS = 620_000

// undici 默认在等待响应头 300 秒后中止；总超时由路由级 AbortController 持有。
const openAIDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
})

function goGatewayBaseUrl() {
  return (process.env.GO_GATEWAY_BASE_URL || '').replace(/\/+$/, '')
}

function proxyTimeoutMs() {
  const configured = Number(process.env.GO_GATEWAY_PROXY_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PROXY_TIMEOUT_MS
}

// Node 会从 socket 层重新推导这些头，转发它们既无意义又会让 fetch 直接失败：
// undici 对 transfer-encoding、keep-alive 这类头会抛 TypeError，代理只能回 502。
// 外部 OpenAI 客户端常用 chunked 上传大图，不剥离就会踩到。
const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-connection',
  'proxy-authorization',
  'proxy-authenticate',
])

export function requestHeaders(req: Request) {
  const headers = new Headers()
  // Connection 头可以点名额外的逐跳头（如 Connection: x-custom），
  // 这些同样不能转发到下一跳。
  const nominated = new Set(
    String(req.headers.connection || '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  )
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue
    const lower = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower) || nominated.has(lower)) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

router.use(async (req: Request, res: Response, next) => {
  const baseUrl = goGatewayBaseUrl()
  if (!baseUrl) {
    res.status(503).json(apiErrorBody(req, 'GO_SIDECAR_UNAVAILABLE', 'Go image service is not configured.'))
    return
  }

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req
  const controller = new AbortController()
  let abortReason: 'timeout' | 'client_disconnect' | null = null
  let timeout: ReturnType<typeof setTimeout>

  const abortUpstream = (reason: 'timeout' | 'client_disconnect') => {
    if (controller.signal.aborted) return
    abortReason = reason
    clearTimeout(timeout)
    controller.abort()
  }

  timeout = setTimeout(() => abortUpstream('timeout'), proxyTimeoutMs())

  req.once('close', () => {
    if (req.destroyed && !req.complete) abortUpstream('client_disconnect')
  })
  res.once('close', () => {
    if (!res.writableEnded) abortUpstream('client_disconnect')
  })

  // 长耗时生图：告知反向代理不要缓冲，立即转发。
  res.setHeader('X-Accel-Buffering', 'no')

  try {
    // /v1 路径原样转发给 Go 网关（Go 侧同样挂在 /v1 下）。
    const upstream = await fetch(`${baseUrl}${req.originalUrl}`, {
      method: req.method,
      headers: requestHeaders(req),
      body,
      duplex: body ? 'half' : undefined,
      signal: controller.signal,
      dispatcher: openAIDispatcher,
    })

    res.status(upstream.status)
    upstream.headers.forEach((value, key) => {
      if (['connection', 'content-encoding', 'content-length', 'transfer-encoding', 'x-accel-buffering', 'x-request-id'].includes(key.toLowerCase())) return
      res.setHeader(key, value)
    })
    res.setHeader('X-Accel-Buffering', 'no')

    if (!upstream.body) {
      res.end()
      return
    }

    const responseStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>)
    await pipeline(responseStream, res)
  } catch (err: any) {
    if (abortReason === 'client_disconnect') return
    console.error('[openai-proxy] proxy failed:', err?.message || err)
    const status = abortReason === 'timeout' ? 504 : 502
    const code = status === 504 ? 'GO_SIDECAR_TIMEOUT' : 'GO_SIDECAR_UNAVAILABLE'
    if (!res.headersSent) {
      res.status(status).json(apiErrorBody(req, code, 'Go image service is temporarily unavailable.'))
    }
  } finally {
    clearTimeout(timeout)
  }
})

export default router
