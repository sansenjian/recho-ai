import { ref } from 'vue'
import { apiUrl } from '../lib/api-base'
import { getAuthAccessToken } from './useAuthSession'

/** 评价对象所属场景：对话页或工作台生图。 */
export type FeedbackSurface = 'chat' | 'image'

/**
 * 消息评价状态。
 *
 * 评价按消息 id 存在服务端（同一用户同一消息只有一条），这里只缓存当前已知的值，
 * 避免每次渲染都回查。乐观更新：点下去先改本地，失败再回滚——否则每次点击都要
 * 等一个往返，按钮像卡住了。
 */
export function useMessageFeedback(surface: FeedbackSurface) {
  const values = ref<Record<string, number>>({})

  /**
   * 每个消息键上最近一次提交的序号。
   *
   * 连点好评再点差评会并发出两个请求，两次提交可能以任意顺序结束，所以
   * 「数一数还有几个在跑」判断不了该不该回滚：
   *
   *   好评(A) → 差评(B) → B 成功 → A 失败
   *
   * 此时 A 结束时计数只剩它自己，按计数就会把界面回滚成未评价，而服务端存的是
   * B 的差评。改为比较序号：只有本次仍是这个键上的最新一笔时才允许回滚。
   */
  const latestSeq = new Map<string, number>()
  let seqCounter = 0

  async function request(path: string, init: RequestInit = {}) {
    const token = await getAuthAccessToken()
    // 没有 token 时必须抛错：返回 null 会让 submit 以为写入成功，界面留在一个
    // 从未存到服务端的状态上，刷新后凭空消失。访客也能进工作台，这条路径会走到。
    if (!token) throw new Error('feedback requires sign-in')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body) headers.set('Content-Type', 'application/json')
    const response = await fetch(apiUrl(path), { ...init, headers })
    if (!response.ok) throw new Error('feedback request failed')
    return response.json().catch(() => null)
  }

  /** 读取一批消息的评价；接口不可用时静默失败，不影响阅读。 */
  async function load(keys: string[]) {
    const wanted = keys.filter(Boolean)
    if (!wanted.length) return
    try {
      // 用重复参数而不是逗号连接：消息键是前端生成的字符串，本身可能含逗号。
      const query = wanted.map(key => `keys=${encodeURIComponent(key)}`).join('&')
      const data = await request(`/api/message-feedback?${query}`)
      const feedback = (data as { feedback?: Record<string, number> } | null)?.feedback
      if (feedback) values.value = { ...values.value, ...feedback }
    } catch {
      // 拉不到评价不该挡住消息本身，保持未评价状态即可。
    }
  }

  /**
   * 提交评价。传 0 表示撤销（再点一次已选中的按钮）。
   *
   * 返回是否成功，调用方据此决定要不要提示。
   */
  async function submit(messageKey: string, value: number) {
    const previous = values.value[messageKey] ?? 0
    if (value === previous && value !== 0) return true

    // 先改本地再发请求：按钮要立刻响应。
    if (value === 0) {
      const next = { ...values.value }
      delete next[messageKey]
      values.value = next
    } else {
      values.value = { ...values.value, [messageKey]: value }
    }

    const seq = ++seqCounter
    latestSeq.set(messageKey, seq)
    try {
      if (value === 0) {
        await request(`/api/message-feedback/${encodeURIComponent(messageKey)}`, { method: 'DELETE' })
      } else {
        await request('/api/message-feedback', {
          method: 'PUT',
          body: JSON.stringify({ messageKey, value, surface }),
        })
      }
      return true
    } catch {
      // 只有本次仍是这个键上的最新一笔才回滚。晚到的失败不该抹掉用户后来的选择：
      // 好评请求失败时，若之后点过差评且已成功，界面必须保留差评。
      if (latestSeq.get(messageKey) === seq) {
        values.value = { ...values.value, [messageKey]: previous }
        if (previous === 0) {
          const next = { ...values.value }
          delete next[messageKey]
          values.value = next
        }
      }
      return false
    }
  }

  return { values, load, submit }
}
