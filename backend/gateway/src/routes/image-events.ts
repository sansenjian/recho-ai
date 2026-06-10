import { Router, Request, Response } from 'express'
import {
  isImageAnalyticsEnabled,
  imageEventSources,
  imageEventTypes,
  recordImageEvent,
  sanitizeImageEventMetadata,
} from '../services/image-analytics.js'
import { getRequestUserId } from '../services/request-auth.js'

const router = Router()
const IMAGE_EVENT_RATE_LIMIT = 30
const IMAGE_EVENT_RATE_WINDOW_MS = 60_000
const IMAGE_EVENT_RATE_BUCKET_MAX = 5_000

const eventRateBuckets = new Map<string, { count: number; resetAt: number }>()

function safeKeyPart(value: unknown, maxLength = 120) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, '').slice(0, maxLength)
    : ''
}

function eventRateLimitKey(req: Request, userId?: string | null) {
  if (userId) return `user:${userId}`

  const sessionId = safeKeyPart(req.body?.sessionId)
  if (sessionId) return `session:${sessionId}`

  return `ip:${safeKeyPart(req.ip || req.socket.remoteAddress || 'unknown', 80) || 'unknown'}`
}

function pruneEventRateBuckets(now = Date.now()) {
  if (eventRateBuckets.size <= IMAGE_EVENT_RATE_BUCKET_MAX) return

  for (const [key, bucket] of eventRateBuckets) {
    if (bucket.resetAt <= now) eventRateBuckets.delete(key)
    if (eventRateBuckets.size <= IMAGE_EVENT_RATE_BUCKET_MAX) return
  }

  for (const key of eventRateBuckets.keys()) {
    eventRateBuckets.delete(key)
    if (eventRateBuckets.size <= IMAGE_EVENT_RATE_BUCKET_MAX) return
  }
}

function imageEventRateLimited(key: string) {
  const now = Date.now()
  const bucket = eventRateBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    eventRateBuckets.set(key, { count: 1, resetAt: now + IMAGE_EVENT_RATE_WINDOW_MS })
    pruneEventRateBuckets(now)
    return false
  }

  if (bucket.count >= IMAGE_EVENT_RATE_LIMIT) return true
  bucket.count += 1
  return false
}

router.post('/image/events', async (req: Request, res: Response) => {
  if (!await isImageAnalyticsEnabled()) {
    res.json({ recorded: false })
    return
  }

  const eventType = typeof req.body?.eventType === 'string' ? req.body.eventType : ''
  const source = typeof req.body?.source === 'string' ? req.body.source : ''

  if (!imageEventTypes.has(eventType)) {
    res.status(400).json({ error: 'unsupported image event type' })
    return
  }
  if (!imageEventSources.has(source)) {
    res.status(400).json({ error: 'unsupported image event source' })
    return
  }

  const userId = await getRequestUserId(req)
  if (imageEventRateLimited(eventRateLimitKey(req, userId))) {
    res.json({ recorded: false, limited: true })
    return
  }

  const recorded = await recordImageEvent({
    imageId: typeof req.body?.imageId === 'string' ? req.body.imageId : null,
    userId,
    eventType,
    source,
    sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : null,
    metadata: sanitizeImageEventMetadata(req.body?.metadata),
  })

  res.json({ recorded })
})

export default router
