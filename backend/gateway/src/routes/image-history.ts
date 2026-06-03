import { Router, Request, Response } from 'express'
import {
  clearImageHistory,
  deleteImageHistory,
  hasImageHistoryStore,
  listImageHistory,
  saveImageHistory,
} from '../services/image-history.js'

const router = Router()

router.get('/image/history', async (req: Request, res: Response) => {
  try {
    const rawLimit = Number(req.query.limit)
    const images = await listImageHistory(Number.isFinite(rawLimit) ? rawLimit : undefined)
    res.json({ images, persistence: { enabled: hasImageHistoryStore() } })
  } catch (err: any) {
    console.error('[image-history] list failed:', err.message)
    res.status(500).json({ error: err.message || 'image history list failed' })
  }
})

router.post('/image/history', async (req: Request, res: Response) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 50) : []
    const saved = await saveImageHistory(images)
    res.json({ ok: true, saved, count: images.length, persistence: { enabled: hasImageHistoryStore() } })
  } catch (err: any) {
    console.error('[image-history] save failed:', err.message)
    res.status(500).json({ error: err.message || 'image history save failed' })
  }
})

router.delete('/image/history', async (_req: Request, res: Response) => {
  try {
    const deleted = await clearImageHistory()
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
    const deleted = await deleteImageHistory(id)
    res.json({ ok: true, persistence: { enabled: hasImageHistoryStore(), deleted } })
  } catch (err: any) {
    console.error('[image-history] delete failed:', err.message)
    res.status(500).json({ error: err.message || 'image history delete failed' })
  }
})

export default router
