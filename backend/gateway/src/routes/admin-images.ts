import { Router, Request, Response } from 'express'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import {
  AdminImageError,
  listAdminImages,
  setAdminImageVisibility,
} from '../services/admin-images.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function adminImageErrorResponse(err: unknown) {
  if (err instanceof AdminCreditError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  if (err instanceof AdminImageError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, '图片后台操作失败，请稍后重试。'),
  }
}

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req)
  return assertAdminUser(user)
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

router.get('/admin/images', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const images = await listAdminImages({
      limit: req.query.limit,
      visibility: req.query.visibility,
    })
    res.json({ images })
  } catch (err) {
    console.error('[admin-images] list failed:', safeErrorDetail(err))
    const response = adminImageErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.patch('/admin/images/:id/visibility', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const image = await setAdminImageVisibility(routeParam(req.params.id), req.body?.visibility)
    res.json({ image })
  } catch (err) {
    console.error('[admin-images] visibility update failed:', safeErrorDetail(err))
    const response = adminImageErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
