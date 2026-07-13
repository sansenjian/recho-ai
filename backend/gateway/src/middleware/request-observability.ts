import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Request, RequestHandler } from 'express'

export const REQUEST_ID_HEADER = 'X-Request-ID'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export function requestId(req: Request): string {
  const value = req.headers['x-request-id']
  return typeof value === 'string' ? value : 'unknown'
}

export const requestObservabilityMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id']
  const candidate = typeof incoming === 'string' ? incoming.trim() : ''
  const id = REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID()

  req.headers['x-request-id'] = id
  const startedAt = performance.now()
  const path = req.path
  res.setHeader(REQUEST_ID_HEADER, id)
  res.once('finish', () => {
    console.info(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'node-gateway',
      event: 'request.completed',
      request_id: id,
      method: req.method,
      path,
      status_code: res.statusCode,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    }))
  })
  next()
}
