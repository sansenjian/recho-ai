import { Router, Request, Response } from 'express'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import {
  AdminImageAnalyticsError,
  getAdminImageAnalytics,
} from '../services/admin-image-analytics.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function analyticsErrorResponse(err: unknown) {
  if (err instanceof AdminCreditError) {
    return { status: err.status, error: err.publicMessage }
  }
  if (err instanceof AdminImageAnalyticsError) {
    return { status: err.status, error: err.publicMessage }
  }
  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, '图片分析加载失败，请稍后重试。'),
  }
}

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req)
  return assertAdminUser(user)
}

/**
 * 图片分析概览。
 *
 * 这两张表只有 service_role 可读（RLS 里 anon / authenticated 都被 revoke），
 * 所以必须走管理端鉴权，不能让前端直连。
 */
router.get('/admin/image-analytics', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const analytics = await getAdminImageAnalytics({ hours: req.query.hours })
    res.json({ analytics })
  } catch (err) {
    console.error('[admin-image-analytics] load failed:', safeErrorDetail(err))
    const response = analyticsErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
