import { Router, Request, Response } from 'express'
import {
  AdminCreditError,
  adjustAdminUserCredits,
  assertAdminUser,
  createAdminCreditCodes,
  getAdminCreditUser,
  listAdminCreditCodes,
  listAdminCreditTransactions,
  listAdminCreditUsers,
  setAdminCreditCodeDisabled,
} from '../services/admin-credits.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function adminErrorResponse(err: unknown) {
  if (err instanceof AdminCreditError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
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

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

router.get('/admin/credits/me', async (req: Request, res: Response) => {
  try {
    const user = await requireAdmin(req)
    res.json({ admin: true, user })
  } catch (err) {
    console.warn('[admin-credits] auth failed:', safeErrorDetail(err))
    const response = adminErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.get('/admin/credits/users', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const users = await listAdminCreditUsers({
      query: req.query.query,
      limit: req.query.limit,
    })
    res.json({ users })
  } catch (err) {
    console.error('[admin-credits] list users failed:', safeErrorDetail(err))
    const response = adminErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.get('/admin/credits/users/:userId', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const userId = routeParam(req.params.userId)
    const user = await getAdminCreditUser(userId)
    const transactions = await listAdminCreditTransactions(userId, req.query.limit)
    res.json({ user, transactions })
  } catch (err) {
    console.error('[admin-credits] user detail failed:', safeErrorDetail(err))
    const response = adminErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.post('/admin/credits/users/:userId/adjust', async (req: Request, res: Response) => {
  try {
    const adminUser = await requireAdmin(req)
    const userId = routeParam(req.params.userId)
    const result = await adjustAdminUserCredits(
      userId,
      req.body?.amount,
      adminUser,
      req.body?.note,
    )
    const user = await getAdminCreditUser(userId)
    const transactions = await listAdminCreditTransactions(userId, 20)
    res.json({ result, user, transactions })
  } catch (err) {
    console.error('[admin-credits] adjust failed:', safeErrorDetail(err))
    const response = adminErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.get('/admin/credits/codes', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const codes = await listAdminCreditCodes({ limit: req.query.limit })
    res.json({ codes })
  } catch (err) {
    console.error('[admin-credits] list codes failed:', safeErrorDetail(err))
    const response = adminErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.post('/admin/credits/codes', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const codes = await createAdminCreditCodes(req.body || {})
    res.json({ codes })
  } catch (err) {
    console.error('[admin-credits] create codes failed:', safeErrorDetail(err))
    const response = adminErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.patch('/admin/credits/codes/:codeId', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const code = await setAdminCreditCodeDisabled(routeParam(req.params.codeId), Boolean(req.body?.disabled))
    res.json({ code })
  } catch (err) {
    console.error('[admin-credits] update code failed:', safeErrorDetail(err))
    const response = adminErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
