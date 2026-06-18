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
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function publicHistoryImage(image: ImageHistoryItem, options: { includeOriginal?: boolean } = {}) {
  const {
    requestIp: _requestIp,
    requestUserAgent: _requestUserAgent,
    provider: _provider,
    imageModel: _imageModel,
    textModel: _textModel,
    latencyMs: _latencyMs,
    creditTransactionId: _creditTransactionId,
    sourceBuffer: _sourceBuffer,
    sourceMime: _sourceMime,
    dataUrl,
    ...publicImage
  } = image
  return {
    ...publicImage,
    ...(options.includeOriginal && dataUrl ? { dataUrl } : {}),
  }
}

function referenceImageCount(image: ImageHistoryItem) {
  return image.referenceImageCount ?? image.references?.length ?? 0
}

function publicGallerySummaryImage(image: ImageHistoryItem) {
  const publicImage = publicHistoryImage(image)
  const references = publicImage.references ?? []
  return {
    id: publicImage.id,
    prompt: publicImage.prompt,
    storagePath: publicImage.storagePath,
    thumbnailUrl: publicImage.thumbnailUrl,
    size: publicImage.size,
    aspectRatio: publicImage.aspectRatio,
    resolution: publicImage.resolution,
    quality: publicImage.quality,
    timestamp: publicImage.timestamp,
    referenceImageCount: referenceImageCount(publicImage),
    ...(references.length ? { references } : {}),
  }
}

function publicGalleryDetailImage(image: ImageHistoryItem, options: { includeOriginal?: boolean } = {}) {
  const publicImage = publicHistoryImage(image, options)

  return {
    ...publicGallerySummaryImage(publicImage),
    storagePath: publicImage.storagePath,
    previewUrl: publicImage.previewUrl,
    previewPath: publicImage.previewPath,
    thumbnailPath: publicImage.thumbnailPath,
    ...(options.includeOriginal && publicImage.dataUrl ? { dataUrl: publicImage.dataUrl } : {}),
  }
}

function historyScope(req: Request) {
  return req.query.scope === 'mine' ? 'mine' : 'public'
}

function includeOriginal(req: Request) {
  return req.query.original === '1' || req.query.original === 'true'
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
      images: history.images.map(image => scope === 'public'
        ? publicGallerySummaryImage(image)
        : publicHistoryImage(image)),
      persistence: { enabled: hasImageHistoryStore() },
    })
  } catch (err: any) {
    console.error('[image-history] list failed:', safeErrorDetail(err))
    res.status(500).json({ error: publicErrorMessage(err, '图片历史加载失败，请稍后重试。') })
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
      images: savedImages?.map(image => publicHistoryImage(image)) || [],
      persistence: { enabled: hasImageHistoryStore() },
    })
  } catch (err: any) {
    console.error('[image-history] save failed:', safeErrorDetail(err))
    res.status(500).json({ error: publicErrorMessage(err, '图片历史保存失败，请稍后重试。') })
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
    const wantsOriginal = includeOriginal(req)
    const image = await getImageHistory(id, { scope, userId, includeOriginal: wantsOriginal })
    if (!image) {
      res.status(404).json({ error: 'image history item not found' })
      return
    }

    res.json({
      image: scope === 'public'
        ? publicGalleryDetailImage(image, { includeOriginal: wantsOriginal })
        : publicHistoryImage(image, { includeOriginal: wantsOriginal }),
      persistence: { enabled: hasImageHistoryStore() },
    })
  } catch (err: any) {
    console.error('[image-history] detail failed:', safeErrorDetail(err))
    res.status(500).json({ error: publicErrorMessage(err, '图片详情加载失败，请稍后重试。') })
  }
})

router.delete('/image/history', async (req: Request, res: Response) => {
  try {
    const userId = await getRequestUserId(req)
    const deleted = await clearImageHistory({ userId })
    res.json({ ok: true, persistence: { enabled: hasImageHistoryStore(), deleted } })
  } catch (err: any) {
    console.error('[image-history] clear failed:', safeErrorDetail(err))
    res.status(500).json({ error: publicErrorMessage(err, '图片历史清理失败，请稍后重试。') })
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
    console.error('[image-history] delete failed:', safeErrorDetail(err))
    res.status(500).json({ error: publicErrorMessage(err, '图片历史删除失败，请稍后重试。') })
  }
})

export default router
