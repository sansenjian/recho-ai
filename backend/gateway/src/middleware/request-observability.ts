import { randomUUID } from 'node:crypto'
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
  res.setHeader(REQUEST_ID_HEADER, id)
  next()
}
