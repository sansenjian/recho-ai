import { getAuthAccessToken } from './useAuthSession'
import { apiUrl } from '../lib/api-base'
import i18n from '../i18n'

const ADMIN_REQUEST_TIMEOUT_MS = 15_000

export async function adminApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthAccessToken()
  if (!token) throw new Error(i18n.global.t('feedback.loginRequired'))

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const timeoutSignal = AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS)
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal
  const response = await fetch(apiUrl(path), { ...init, headers, signal })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // 后端同时返回中文文案与机器可读错误码；把错误码挂在 error 上，
    // 让调用方可以显示本地化文案而不是直接渲染后端中文。
    const error = new Error(typeof data?.error === 'string' ? data.error : i18n.global.t('feedback.requestFailed'))
    if (typeof data?.code === 'string') (error as Error & { code?: string }).code = data.code
    throw error
  }
  return data as T
}
