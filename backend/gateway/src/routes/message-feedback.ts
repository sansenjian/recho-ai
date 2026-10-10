import { Router, Request, Response } from 'express'
import { AdminCreditError } from '../services/admin-credits.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'
import {
  MessageFeedbackError,
  clearMessageFeedback,
  listMessageFeedback,
  saveMessageFeedback,
} from '../services/message-feedback.js'

const router = Router()

/** 任意已登录用户（支持 Supabase token 与 rk- key）。 */
async function requireUser(req: Request) {
  const user = await getRequestUser(req)
  if (!user) throw new AdminCreditError('auth_required')
  return user
}

function feedbackErrorResponse(err: unknown) {
  if (err instanceof MessageFeedbackError) {
    return { status: err.status, error: err.publicMessage }
  }
  if (err instanceof AdminCreditError) {
    return { status: err.status, error: err.publicMessage }
  }
  return {
    status: typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500,
    error: publicErrorMessage(err, '评价操作失败，请稍后重试。'),
  }
}

// --- 消息评价：只作用于当前登录用户自己的记录 ---

router.get('/message-feedback', async (req: Request, res: Response) => {
  try {
    const user = await requireUser(req)
    const raw = req.query.keys
    // 支持 ?keys=a,b,c；也支持重复参数 ?keys=a&keys=b。
    const keys = Array.isArray(raw)
      ? raw.flatMap(item => String(item).split(','))
      : typeof raw === 'string' ? raw.split(',') : []
    res.json({ feedback: await listMessageFeedback(user.id, keys) })
  } catch (err) {
    console.error('[message-feedback] list failed:', safeErrorDetail(err))
    const response = feedbackErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.put('/message-feedback', async (req: Request, res: Response) => {
  try {
    const user = await requireUser(req)
    const body = (req.body || {}) as { messageKey?: unknown; value?: unknown; surface?: unknown }
    const record = await saveMessageFeedback(user.id, {
      messageKey: body.messageKey,
      value: body.value,
      surface: body.surface,
    })
    res.json({ feedback: record })
  } catch (err) {
    console.error('[message-feedback] save failed:', safeErrorDetail(err))
    const response = feedbackErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

router.delete('/message-feedback/:messageKey', async (req: Request, res: Response) => {
  try {
    const user = await requireUser(req)
    await clearMessageFeedback(user.id, req.params.messageKey)
    res.json({ ok: true })
  } catch (err) {
    console.error('[message-feedback] clear failed:', safeErrorDetail(err))
    const response = feedbackErrorResponse(err)
    res.status(response.status).json({ error: response.error })
  }
})

export default router
