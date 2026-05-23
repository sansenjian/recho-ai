import { Router, Request, Response } from 'express'
import { skillLoader } from '../skills/loader.js'

const router = Router()

router.get('/skills', (_req: Request, res: Response) => {
  res.json({ skills: skillLoader.getAll() })
})

export default router
