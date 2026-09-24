import { Router, Request, Response } from 'express'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import {
  AdminImageError,
  bulkArchiveAdminImages,
  bulkDeleteAdminImages,
  bulkSetAdminImageVisibility,
  getAdminImageStorageOverview,
  listAdminImages,
  resolveAdminImageMediaPath,
  setAdminImageVisibility,
  type AdminImageMediaKind,
} from '../services/admin-images.js'
import { downloadImageBuffer } from '../services/image-storage.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()
const MEDIA_KINDS: AdminImageMediaKind[] = ['thumbnail', 'preview', 'original']

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

function mediaKind(value: unknown): AdminImageMediaKind {
  return MEDIA_KINDS.includes(value as AdminImageMediaKind) ? value as AdminImageMediaKind : 'thumbnail'
}

/**
 * 管理台媒体兜底:公开地址不可用时(如 COS 未配公开域名),用户侧代理
 * /api/image/storage/* 会按归属拒绝他人私有图,管理台因此裂图。
 * 这里在管理员鉴权后由 Node 直接读存储字节返回,不经过用户侧路由。
 */
router.get('/admin/images/:id/media', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const storagePath = await resolveAdminImageMediaPath(routeParam(req.params.id), mediaKind(req.query.kind))
    if (!storagePath) {
      res.status(404).json({ error: '图片不存在。' })
      return
    }

    const media = await downloadImageBuffer(storagePath)
    if (!media) {
      res.status(404).json({ error: '图片不存在。' })
      return
    }

    res.setHeader('Content-Type', media.mime)
    // 私有图片字节 + 管理接口:禁止浏览器与中间层缓存
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(media.buffer)
  } catch (err) {
    console.error('[admin-images] media read failed:', safeErrorDetail(err))
    const response = adminImageErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.get('/admin/images', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const images = await listAdminImages({
      limit: req.query.limit,
      visibility: req.query.visibility,
      fundingSource: req.query.fundingSource,
      userId: req.query.userId,
      query: req.query.query,
    })
    res.json({ images })
  } catch (err) {
    console.error('[admin-images] list failed:', safeErrorDetail(err))
    const response = adminImageErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.get('/admin/images/storage-overview', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const overview = await getAdminImageStorageOverview()
    res.json({ overview })
  } catch (err) {
    console.error('[admin-images] storage overview failed:', safeErrorDetail(err))
    const response = adminImageErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.patch('/admin/images/bulk/visibility', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const images = await bulkSetAdminImageVisibility(req.body?.ids, req.body?.visibility)
    res.json({ images })
  } catch (err) {
    console.error('[admin-images] bulk visibility update failed:', safeErrorDetail(err))
    const response = adminImageErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.post('/admin/images/bulk/archive', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const images = await bulkArchiveAdminImages(req.body?.ids)
    res.json({ images })
  } catch (err) {
    console.error('[admin-images] bulk archive failed:', safeErrorDetail(err))
    const response = adminImageErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.post('/admin/images/bulk/delete', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const result = await bulkDeleteAdminImages(req.body?.ids)
    res.json(result)
  } catch (err) {
    console.error('[admin-images] bulk delete failed:', safeErrorDetail(err))
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
