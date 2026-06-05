import { Router, Request, Response } from 'express'
import {
  clearImageHistory,
  deleteImageHistory,
  getImageHistory,
  hasImageHistoryStore,
  listImageHistory,
  saveImageHistory,
} from '../services/image-history.js'
import { getRequestUserId } from '../services/request-auth.js'
import type { ImageHistoryItem } from '../services/image-history.js'

const router = Router()

function publicHistoryImage(image: ImageHistoryItem) {
  const {
    requestIp: _requestIp,
    requestUserAgent: _requestUserAgent,
    ...publicImage
  } = image
  return publicImage
}

function isInlineImageDataUrl(value?: string | null) {
  return Boolean(value && /^data:image\//i.test(value))
}

function referenceImageCount(image: ImageHistoryItem) {
  return image.references?.length ?? 0
}

function publicGallerySummaryImage(image: ImageHistoryItem) {
  const publicImage = publicHistoryImage(image)
  return {
    id: publicImage.id,
    prompt: publicImage.prompt,
    thumbnailUrl: publicImage.thumbnailUrl,
    size: publicImage.size,
    aspectRatio: publicImage.aspectRatio,
    resolution: publicImage.resolution,
    quality: publicImage.quality,
    timestamp: publicImage.timestamp,
    referenceImageCount: referenceImageCount(publicImage),
  }
}

function publicGalleryDetailImage(image: ImageHistoryItem) {
  const publicImage = publicHistoryImage(image)
  const originalUrl = publicImage.dataUrl && !isInlineImageDataUrl(publicImage.dataUrl)
    ? publicImage.dataUrl
    : undefined

  return {
    ...publicGallerySummaryImage(publicImage),
    ...(originalUrl ? { dataUrl: originalUrl } : {}),
  }
}

function historyScope(req: Request) {
  return req.query.scope === 'mine' ? 'mine' : 'public'
}

router.get('/image/history', async (req: Request, res: Response) => {
  try {
    const rawLimit = Number(req.query.limit)
    const rawOffset = Number(req.query.offset)
    const scope = historyScope(req)
    const userId = scope === 'mine' ? await getRequestUserId(req) : null
    const history = await listImageHistory(
      Number.isFinite(rawLimit) ? rawLimit : undefined,
      Number.isFinite(rawOffset) ? rawOffset : undefined,
      { scope, userId },
    )
    res.json({
      ...history,
      images: history.images.map(scope === 'public' ? publicGallerySummaryImage : publicHistoryImage),
      persistence: { enabled: hasImageHistoryStore() },
    })
  } catch (err: any) {
    console.error('[image-history] list failed:', err.message)
    res.status(500).json({ error: err.message || 'image history list failed' })
  }
})

router.post('/image/history', async (req: Request, res: Response) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 50) : []
    const userId = await getRequestUserId(req)
    const savedImages = await saveImageHistory(images, { userId })
    res.json({
      ok: true,
      saved: Boolean(savedImages),
      count: savedImages?.length ?? 0,
      images: savedImages?.map(publicHistoryImage) || [],
      persistence: { enabled: hasImageHistoryStore() },
    })
  } catch (err: any) {
    console.error('[image-history] save failed:', err.message)
    res.status(500).json({ error: err.message || 'image history save failed' })
  }
})

router.get('/image/history/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (!id) {
      res.status(400).json({ error: 'image history id is required' })
      return
    }

    const scope = historyScope(req)
    const userId = scope === 'mine' ? await getRequestUserId(req) : null
    const image = await getImageHistory(id, { scope, userId })
    if (!image) {
      res.status(404).json({ error: 'image history item not found' })
      return
    }

    res.json({
      image: scope === 'public' ? publicGalleryDetailImage(image) : publicHistoryImage(image),
      persistence: { enabled: hasImageHistoryStore() },
    })
  } catch (err: any) {
    console.error('[image-history] detail failed:', err.message)
    res.status(500).json({ error: err.message || 'image history detail failed' })
  }
})

router.delete('/image/history', async (req: Request, res: Response) => {
  try {
    const userId = await getRequestUserId(req)
    const deleted = await clearImageHistory({ userId })
    res.json({ ok: true, persistence: { enabled: hasImageHistoryStore(), deleted } })
  } catch (err: any) {
    console.error('[image-history] clear failed:', err.message)
    res.status(500).json({ error: err.message || 'image history clear failed' })
  }
})

router.delete('/image/history/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (!id) {
      res.status(400).json({ error: 'image history id is required' })
      return
    }
    const userId = await getRequestUserId(req)
    const deleted = await deleteImageHistory(id, { userId })
    res.json({ ok: true, persistence: { enabled: hasImageHistoryStore(), deleted } })
  } catch (err: any) {
    console.error('[image-history] delete failed:', err.message)
    res.status(500).json({ error: err.message || 'image history delete failed' })
  }
})

export default router
