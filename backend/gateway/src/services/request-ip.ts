import type { Request } from 'express'
import { isIP } from 'node:net'

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function firstForwardedIp(value: string | undefined) {
  return value?.split(',').map(item => item.trim()).find(Boolean)
}

function normalizeIp(value: string | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed
  return isIP(normalized) ? normalized : null
}

export function requestIp(req: Request) {
  return normalizeIp(
    firstHeaderValue(req.headers['cf-connecting-ip']) ||
    firstHeaderValue(req.headers['x-real-ip']) ||
    firstForwardedIp(firstHeaderValue(req.headers['x-forwarded-for'])) ||
    req.socket.remoteAddress,
  )
}

export function requestUserAgent(req: Request) {
  return firstHeaderValue(req.headers['user-agent'])?.slice(0, 500) || null
}
