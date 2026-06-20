import { Router, Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

const router = Router()
const GO_GATEWAY_BASE_URL = (process.env.GO_GATEWAY_BASE_URL || '').replace(/\/+$/, '')
const DEFAULT_PROXY_TIMEOUT_MS = 620_000
const parsedProxyTimeoutMs = Number(process.env.GO_GATEWAY_PROXY_TIMEOUT_MS)
const PROXY_TIMEOUT_MS = Number.isFinite(parsedProxyTimeoutMs) && parsedProxyTimeoutMs > 0
  ? parsedProxyTimeoutMs
  : DEFAULT_PROXY_TIMEOUT_MS

const proxiedRoutes = [
  /^\/image\/references(?:\/|$)/,
  /^\/image\/storage(?:\/|$)/,
  /^\/image\/generate(?:\/|$)/,
  /^\/credits(?:\/|$)/,
  /^\/config\/app(?:\/|$)/,
  /^\/config\/supabase(?:\/|$)/,
]

function shouldProxy(path: string) {
  return Boolean(GO_GATEWAY_BASE_URL) && proxiedRoutes.some(pattern => pattern.test(path))
}

function requestUrl(req: Request) {
  return `${GO_GATEWAY_BASE_URL}/api${req.originalUrl.replace(/^\/api/, '')}`
}

function requestHeaders(req: Request) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || ['host', 'connection', 'content-length'].includes(key.toLowerCase())) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

function requestBody(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  return req
}

router.use(async (req: Request, res: Response, next) => {
  if (!shouldProxy(req.path)) {
    next()
    return
  }

  const body = requestBody(req)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

  try {
    const upstream = await fetch(requestUrl(req), {
      method: req.method,
      headers: requestHeaders(req),
      body,
      duplex: body ? 'half' : undefined,
      signal: controller.signal,
    } as RequestInit & { duplex?: 'half' })

    res.status(upstream.status)
    upstream.headers.forEach((value, key) => {
      if (['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) return
      res.setHeader(key, value)
    })

    if (!upstream.body) {
      res.end()
      return
    }

    const responseStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>)
    await pipeline(responseStream, res)
  } catch (err: any) {
    console.error('[go-sidecar] proxy failed:', err?.message || err)
    if (!res.headersSent) {
      res.status(err?.name === 'AbortError' ? 504 : 502).json({ error: 'Go image service is temporarily unavailable.' })
    }
  } finally {
    clearTimeout(timeout)
  }
})

export default router
