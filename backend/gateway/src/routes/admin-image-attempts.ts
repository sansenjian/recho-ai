import { Router, Request, Response } from 'express'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import {
  AdminImageAttemptError,
  listAdminImageAttempts,
} from '../services/admin-image-attempts.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function adminAttemptErrorResponse(err: unknown) {
  if (err instanceof AdminCreditError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  if (err instanceof AdminImageAttemptError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, '生图监控加载失败，请稍后重试。'),
  }
}

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req)
  return assertAdminUser(user)
}

router.get('/admin/image-attempts', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const result = await listAdminImageAttempts({
      limit: req.query.limit,
      status: req.query.status,
    })
    res.json(result)
  } catch (err) {
    console.error('[admin-image-attempts] list failed:', safeErrorDetail(err))
    const response = adminAttemptErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
