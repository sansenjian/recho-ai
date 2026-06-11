import { Router, Request, Response } from 'express'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import {
  AdminAnnouncementError,
  createAdminAnnouncement,
  listAdminAnnouncements,
  listPublishedAnnouncements,
  updateAdminAnnouncement,
} from '../services/admin-announcements.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function announcementErrorResponse(err: unknown) {
  if (err instanceof AdminCreditError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  if (err instanceof AdminAnnouncementError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, '公告操作失败，请稍后重试。'),
  }
}

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req)
  return assertAdminUser(user)
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

router.get('/announcements', async (req: Request, res: Response) => {
  try {
    const announcements = await listPublishedAnnouncements({ limit: req.query.limit })
    res.json({ announcements })
  } catch (err) {
    console.error('[announcements] list failed:', safeErrorDetail(err))
    const response = announcementErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.get('/admin/announcements', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const announcements = await listAdminAnnouncements({
      limit: req.query.limit,
      status: req.query.status,
    })
    res.json({ announcements })
  } catch (err) {
    console.error('[admin-announcements] list failed:', safeErrorDetail(err))
    const response = announcementErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.post('/admin/announcements', async (req: Request, res: Response) => {
  try {
    const adminUser = await requireAdmin(req)
    const announcement = await createAdminAnnouncement(req.body || {}, adminUser)
    res.json({ announcement })
  } catch (err) {
    console.error('[admin-announcements] create failed:', safeErrorDetail(err))
    const response = announcementErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.patch('/admin/announcements/:announcementId', async (req: Request, res: Response) => {
  try {
    const adminUser = await requireAdmin(req)
    const announcement = await updateAdminAnnouncement(
      routeParam(req.params.announcementId),
      req.body || {},
      adminUser,
    )
    res.json({ announcement })
  } catch (err) {
    console.error('[admin-announcements] update failed:', safeErrorDetail(err))
    const response = announcementErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
