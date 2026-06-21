import { Router, Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { recordImageGenerationAttempt } from '../services/image-attempts.js'
import {
  firstImageID,
  imageAttemptErrorType,
  parseImageAttemptResponseJSON,
  responseErrorMessage,
} from '../services/go-sidecar-image-attempt.js'
import { getRequestUserId } from '../services/request-auth.js'
import { requestIp, requestUserAgent } from '../services/request-ip.js'
import { safeErrorDetail } from '../services/safe-error.js'

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

function isImageGenerateRequest(req: Request) {
  return req.method === 'POST' && /^\/image\/generate(?:\/|$)/.test(req.path)
}

async function requestUserId(req: Request) {
  try {
    return await getRequestUserId(req)
  } catch (err) {
    console.warn('[go-sidecar] failed to resolve user for image attempt:', safeErrorDetail(err))
    return null
  }
}

async function recordProxiedImageAttempt(
  req: Request,
  status: number,
  responseBody: Buffer,
  startedAt: number,
) {
  const parsed = parseImageAttemptResponseJSON(responseBody)
  const succeeded = status >= 200 && status < 300

  await recordImageGenerationAttempt({
    generationId: succeeded ? firstImageID(parsed) : null,
    userId: await requestUserId(req),
    provider: 'go-sidecar',
    status: succeeded ? 'succeeded' : 'failed',
    latencyMs: Date.now() - startedAt,
    errorType: succeeded ? null : imageAttemptErrorType(status),
    errorMessage: succeeded ? null : safeErrorDetail(responseErrorMessage(parsed, responseBody), 'Go image generation failed'),
    httpStatus: status,
    requestId: req.get('x-request-id') || null,
    requestIp: requestIp(req),
    requestUserAgent: requestUserAgent(req),
  })
}

async function recordProxyFailure(req: Request, err: unknown, status: number, startedAt: number) {
  await recordImageGenerationAttempt({
    userId: await requestUserId(req),
    provider: 'go-sidecar',
    status: 'failed',
    latencyMs: Date.now() - startedAt,
    errorType: status === 504 ? 'timeout' : 'provider',
    errorMessage: safeErrorDetail(err, 'Go image service is temporarily unavailable.'),
    httpStatus: status,
    requestId: req.get('x-request-id') || null,
    requestIp: requestIp(req),
    requestUserAgent: requestUserAgent(req),
  })
}

router.use(async (req: Request, res: Response, next) => {
  if (!shouldProxy(req.path)) {
    next()
    return
  }

  const body = requestBody(req)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
  const startedAt = Date.now()
  const trackImageAttempt = isImageGenerateRequest(req)

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
      if (trackImageAttempt) {
        void recordProxiedImageAttempt(req, upstream.status, Buffer.alloc(0), startedAt).catch((err) => {
          console.warn('[go-sidecar] image attempt record skipped:', safeErrorDetail(err))
        })
      }
      res.end()
      return
    }

    if (trackImageAttempt) {
      const responseBody = Buffer.from(await upstream.arrayBuffer())
      void recordProxiedImageAttempt(req, upstream.status, responseBody, startedAt).catch((err) => {
        console.warn('[go-sidecar] image attempt record skipped:', safeErrorDetail(err))
      })
      res.send(responseBody)
      return
    }

    const responseStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>)
    await pipeline(responseStream, res)
  } catch (err: any) {
    console.error('[go-sidecar] proxy failed:', err?.message || err)
    const status = err?.name === 'AbortError' ? 504 : 502
    if (trackImageAttempt) {
      void recordProxyFailure(req, err, status, startedAt).catch((recordErr) => {
        console.warn('[go-sidecar] image attempt failure record skipped:', safeErrorDetail(recordErr))
      })
    }
    if (!res.headersSent) {
      res.status(status).json({ error: 'Go image service is temporarily unavailable.' })
    }
  } finally {
    clearTimeout(timeout)
  }
})

export default router
