import { Router, Request, Response } from 'express'
import {
  AdminCreditError,
  assertAdminUser,
} from '../services/admin-credits.js'
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyRecord } from '../services/api-keys.js'
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

/** 任意已登录用户(支持 Supabase token 与 rk- key)。 */
async function requireUser(req: Request) {
  const user = await getRequestUser(req)
  if (!user) throw new AdminCreditError('auth_required')
  return user
}

/** 用户侧视图:不回传 key_hash(库内哈希)与 user_id(即调用方自己)。 */
function toUserApiKey(record: ApiKeyRecord) {
  return {
    id: record.id,
    name: record.name,
    key_hint: record.key_hint,
    enabled: record.enabled,
    revoked_at: record.revoked_at,
    last_used_at: record.last_used_at,
    created_at: record.created_at,
  }
}

// --- 用户自助入口:签发/查看/撤销都只作用于当前登录用户自己的 key ---

router.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const user = await requireUser(req)
    const keys = await listApiKeys(user.id)
    res.json({ keys: keys.map(toUserApiKey) })
  } catch (err) {
    console.warn('[api-keys] user list failed:', safeErrorDetail(err))
    const r = adminErrorResponse(err)
    res.status(r.status).json({ error: r.error })
  }
})

router.post('/api-keys', async (req: Request, res: Response) => {
  try {
    const user = await requireUser(req)
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
    console.warn('[api-keys] user create failed:', safeErrorDetail(err))
    const r = adminErrorResponse(err)
    res.status(r.status).json({ error: r.error })
  }
})

router.delete('/api-keys/:id', async (req: Request, res: Response) => {
  try {
    const user = await requireUser(req)
    const id = typeof req.params.id === 'string' ? req.params.id : ''
    if (!id) {
      res.status(400).json({ error: '缺少 key id' })
      return
    }
    // 带 userId 过滤:撤销别人的 key 会命中 0 行,返回 ok=false
    res.json({ ok: await revokeApiKey(id, user.id) })
  } catch (err) {
    console.warn('[api-keys] user revoke failed:', safeErrorDetail(err))
    const r = adminErrorResponse(err)
    res.status(r.status).json({ error: r.error })
  }
})

// --- 管理入口:全站视角 ---

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