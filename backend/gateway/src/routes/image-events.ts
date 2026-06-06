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

router.post('/image/events', async (req: Request, res: Response) => {
  if (!isImageAnalyticsEnabled()) {
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
