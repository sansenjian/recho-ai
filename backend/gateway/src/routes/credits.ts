import { Router, Request, Response } from 'express'
import { getRequestUserId } from '../services/request-auth.js'
import {
  CreditOperationError,
  CreditServiceUnavailableError,
  getUserCreditBalance,
  redeemCreditCode,
} from '../services/credits.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function creditErrorResponse(err: unknown) {
  if (err instanceof CreditOperationError || err instanceof CreditServiceUnavailableError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, '额度操作失败，请稍后重试。'),
  }
}

router.get('/credits', async (req: Request, res: Response) => {
  try {
    const userId = await getRequestUserId(req)
    if (!userId) {
      res.status(401).json({ error: '请先登录后再查看额度。' })
      return
    }

    res.json(await getUserCreditBalance(userId))
  } catch (err) {
    console.error('[credits] balance failed:', safeErrorDetail(err))
    const response = creditErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.post('/credits/redeem', async (req: Request, res: Response) => {
  try {
    const userId = await getRequestUserId(req)
    if (!userId) {
      res.status(401).json({ error: '请先登录后再兑换额度。' })
      return
    }

    const result = await redeemCreditCode(userId, req.body?.code)
    res.json(result)
  } catch (err) {
    console.error('[credits] redeem failed:', safeErrorDetail(err))
    const response = creditErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
