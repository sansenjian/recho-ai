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

  async function request(path: string, init: RequestInit = {}) {
    const token = await getAuthAccessToken()
    if (!token) return null
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
      const data = await request(`/api/message-feedback?keys=${encodeURIComponent(wanted.join(','))}`)
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
      // 失败回滚，避免界面显示一个并没存进服务端的状态。
      values.value = { ...values.value, [messageKey]: previous }
      if (previous === 0) {
        const next = { ...values.value }
        delete next[messageKey]
        values.value = next
      }
      return false
    }
  }

  return { values, load, submit }
}
