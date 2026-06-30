import { Router, Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { recordImageGenerationAttempt, type ImageGenerationAttempt } from '../services/image-attempts.js'
import {
  firstImageID,
  imageAttemptErrorType,
  parseImageAttemptResponseJSON,
  responseErrorMessage,
  shouldBufferImageAttemptBody,
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
  /^\/image\/history(?:\/|$)/,
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

async function imageAttemptBaseFields(
  req: Request,
  startedAt: number,
): Promise<Pick<ImageGenerationAttempt, 'userId' | 'provider' | 'latencyMs' | 'requestId' | 'requestIp' | 'requestUserAgent'>> {
  return {
    userId: await requestUserId(req),
    provider: 'go-sidecar',
    latencyMs: Date.now() - startedAt,
    requestId: req.get('x-request-id') || null,
    requestIp: requestIp(req),
    requestUserAgent: requestUserAgent(req),
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
    ...await imageAttemptBaseFields(req, startedAt),
    generationId: succeeded ? firstImageID(parsed) : null,
    status: succeeded ? 'succeeded' : 'failed',
    errorType: succeeded ? null : imageAttemptErrorType(status),
    errorMessage: succeeded ? null : safeErrorDetail(responseErrorMessage(parsed, responseBody), 'Go image generation failed'),
    httpStatus: status,
  })
}

async function recordProxyFailure(req: Request, err: unknown, status: number, startedAt: number) {
  await recordImageGenerationAttempt({
    ...await imageAttemptBaseFields(req, startedAt),
    status: 'failed',
    errorType: status === 504 ? 'timeout' : 'provider',
    errorMessage: safeErrorDetail(err, 'Go image service is temporarily unavailable.'),
    httpStatus: status,
  })
}

async function recordUpstreamEmptyBody(req: Request, status: number, startedAt: number) {
  await recordImageGenerationAttempt({
    ...await imageAttemptBaseFields(req, startedAt),
    generationId: null,
    status: 'failed',
    errorType: 'upstream_empty_body',
    errorMessage: `Upstream returned status ${status} with an empty body.`,
    httpStatus: status,
  })
}

async function recordStreamedImageAttempt(req: Request, status: number, startedAt: number) {
  const succeeded = status >= 200 && status < 300
  await recordImageGenerationAttempt({
    ...await imageAttemptBaseFields(req, startedAt),
    generationId: null,
    status: succeeded ? 'succeeded' : 'failed',
    errorType: succeeded ? null : imageAttemptErrorType(status),
    errorMessage: succeeded ? null : `Go image generation returned status ${status}; response body was streamed without buffering.`,
    httpStatus: status,
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

  // Abort upstream request when client disconnects. Clear the timeout so the
  // timer doesn't fire after we've already aborted, tying the controller's
  // lifecycle explicitly to the request.
  req.on('close', () => {
    if (!res.writableEnded) {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  const startedAt = Date.now()
  const trackImageAttempt = isImageGenerateRequest(req)

  // Tell reverse proxies (Render/nginx) not to buffer this response so
  // streaming responses are forwarded immediately. This helps prevent
  // 504s on long-running image generation requests.
  res.setHeader('X-Accel-Buffering', 'no')

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
        void recordUpstreamEmptyBody(req, upstream.status, startedAt).catch((err) => {
          console.warn('[go-sidecar] image attempt anomaly record skipped:', safeErrorDetail(err))
        })
      }
      res.end()
      return
    }

    if (trackImageAttempt) {
      if (!shouldBufferImageAttemptBody(upstream.headers.get('content-type'), upstream.headers.get('content-length'))) {
        const responseStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>)
        try {
          await pipeline(responseStream, res)
        } catch (streamErr) {
          console.warn('[go-sidecar] stream pipeline failed:', safeErrorDetail(streamErr))
          // Record as failed if it was a 2xx that failed mid-stream
          void recordStreamedImageAttempt(req, 500, startedAt).catch((err) => {
            console.warn('[go-sidecar] streamed image attempt record skipped:', safeErrorDetail(err))
          })
          return
        }
        // Only record success if pipeline completed
        void recordStreamedImageAttempt(req, upstream.status, startedAt).catch((err) => {
          console.warn('[go-sidecar] streamed image attempt record skipped:', safeErrorDetail(err))
        })
        return
      }

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
