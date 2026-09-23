import { Router, Request, Response } from 'express'
import {
  AdminCreditError,
  assertAdminUser,
} from '../services/admin-credits.js'
import { createApiKey, listApiKeys, revokeApiKey } from '../services/api-keys.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function adminErrorResponse(err: unknown) {
  if (err instanceof AdminCreditError) {
    return { status: err.status, error: err.publicMessage }
  }
  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, '后台操作失败，请稍后重试。'),
  }
}

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req)
  return assertAdminUser(user)
}

router.get('/admin/api-keys', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    res.json({ keys: await listApiKeys() })
  } catch (err) {
    console.warn('[api-keys] list auth failed:', safeErrorDetail(err))
    const r = adminErrorResponse(err)
    res.status(r.status).json({ error: r.error })
  }
})

router.post('/admin/api-keys', async (req: Request, res: Response) => {
  try {
    const user = await requireAdmin(req)
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const { record, issued } = await createApiKey(user.id, name)
    res.status(201).json({
      id: record.id,
      name: record.name,
      hint: issued.hint,
      // 明文仅此一次返回,不落库
      key: issued.plain,
    })
  } catch (err) {
    console.warn('[api-keys] create failed:', safeErrorDetail(err))
    const r = adminErrorResponse(err)
    res.status(r.status).json({ error: r.error })
  }
})

router.delete('/admin/api-keys/:id', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const id = typeof req.params.id === 'string' ? req.params.id : ''
    if (!id) {
      res.status(400).json({ error: '缺少 key id' })
      return
    }
    const revoked = await revokeApiKey(id)
    res.json({ ok: revoked })
  } catch (err) {
    console.warn('[api-keys] revoke failed:', safeErrorDetail(err))
    const r = adminErrorResponse(err)
    res.status(r.status).json({ error: r.error })
  }
})

export default router