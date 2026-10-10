import { getSupabaseAdminClient } from '../clients/supabase.js'

/** 评价对象所属场景：对话页或工作台生图。 */
export type FeedbackSurface = 'chat' | 'image'

/** 好评 1 / 差评 -1。 */
export type FeedbackValue = 1 | -1

export class MessageFeedbackError extends Error {
  readonly code: string
  readonly status: number
  readonly publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.name = 'MessageFeedbackError'
    this.code = code
    this.status = options.status ?? 400
    this.publicMessage = options.publicMessage ?? '操作失败，请稍后重试。'
  }
}

function normalizeSurface(value: unknown): FeedbackSurface {
  return value === 'image' ? 'image' : 'chat'
}

function normalizeValue(value: unknown): FeedbackValue {
  if (value === 1 || value === '1' || value === 'up') return 1
  if (value === -1 || value === '-1' || value === 'down') return -1
  throw new MessageFeedbackError('invalid_feedback_value', {
    publicMessage: '评价只能是好评或差评。',
  })
}

function normalizeKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 200) {
    throw new MessageFeedbackError('invalid_message_key', {
      publicMessage: '消息标识无效。',
    })
  }
  return key
}

/**
 * 记录一次评价。
 *
 * 同一用户对同一消息只保留最新一条：重复提交走 upsert 覆盖，这样「点错了再改」
 * 不会在表里留下两条互相矛盾的评价。
 */
export async function saveMessageFeedback(
  userId: string,
  input: { messageKey: unknown; value: unknown; surface?: unknown },
) {
  const client = getSupabaseAdminClient()
  if (!client) {
    throw new MessageFeedbackError('feedback_unavailable', {
      status: 503,
      publicMessage: '评价服务暂时不可用。',
    })
  }

  const messageKey = normalizeKey(input.messageKey)
  const value = normalizeValue(input.value)
  const surface = normalizeSurface(input.surface)
  const now = new Date().toISOString()

  const { data, error } = await client
    .from('message_feedback')
    .upsert(
      { user_id: userId, message_key: messageKey, value, surface, updated_at: now },
      { onConflict: 'user_id,message_key' },
    )
    .select('message_key, value, surface, updated_at')
    .maybeSingle()
  if (error) throw error

  return data as { message_key: string; value: number; surface: string; updated_at: string }
}

/** 撤销评价：管理员点掉已选中的那一项时用。 */
export async function clearMessageFeedback(userId: string, messageKey: unknown) {
  const client = getSupabaseAdminClient()
  if (!client) {
    throw new MessageFeedbackError('feedback_unavailable', {
      status: 503,
      publicMessage: '评价服务暂时不可用。',
    })
  }
  const key = normalizeKey(messageKey)
  const { error } = await client
    .from('message_feedback')
    .delete()
    .eq('user_id', userId)
    .eq('message_key', key)
  if (error) throw error
}

/**
 * 取当前用户对一批消息的评价。
 *
 * 列表按 key 批量查而不是逐条：一屏可能几十条消息，逐条请求会把首屏拖慢。
 */
export async function listMessageFeedback(userId: string, messageKeys: unknown[]) {
  const client = getSupabaseAdminClient()
  if (!client) return {}
  const keys = messageKeys
    .map(key => (typeof key === 'string' ? key.trim() : ''))
    .filter(key => key && key.length <= 200)
  if (!keys.length) return {}

  const { data, error } = await client
    .from('message_feedback')
    .select('message_key, value')
    .eq('user_id', userId)
    .in('message_key', keys)
  if (error) throw error

  const result: Record<string, number> = {}
  for (const row of data || []) {
    result[String(row.message_key)] = Number(row.value)
  }
  return result
}
