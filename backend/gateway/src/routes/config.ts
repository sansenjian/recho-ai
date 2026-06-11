import { Router, Request, Response } from 'express'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config.js'
import { publicAppConfig } from '../services/app-settings.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

router.get('/config/supabase', (_req: Request, res: Response) => {
  const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

  res.json({
    configured,
    url: configured ? SUPABASE_URL : null,
    publishableKey: configured ? SUPABASE_PUBLISHABLE_KEY : null,
  })
})

router.get('/config/app', async (_req: Request, res: Response) => {
  try {
    res.json(await publicAppConfig())
  } catch (err) {
    console.error('[config] app config failed:', safeErrorDetail(err))
    res.status(500).json({
      error: publicErrorMessage(err, '应用配置加载失败，请稍后重试。'),
    })
  }
})

export default router
