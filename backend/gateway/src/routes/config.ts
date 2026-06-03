import { Router, Request, Response } from 'express'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config.js'

const router = Router()

router.get('/config/supabase', (_req: Request, res: Response) => {
  const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

  res.json({
    configured,
    url: configured ? SUPABASE_URL : null,
    publishableKey: configured ? SUPABASE_PUBLISHABLE_KEY : null,
  })
})

export default router
