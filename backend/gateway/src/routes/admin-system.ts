import { Router, Request, Response } from 'express'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import { getAdminSystemStatus } from '../services/admin-system.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function adminSystemErrorResponse(err: unknown) {
  if (err instanceof AdminCreditError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, '系统状态加载失败，请稍后重试。'),
  }
}

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req)
  return assertAdminUser(user)
}

router.get('/admin/system', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const system = await getAdminSystemStatus()
    res.json({ system })
  } catch (err) {
    console.error('[admin-system] status failed:', safeErrorDetail(err))
    const response = adminSystemErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
