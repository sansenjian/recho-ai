import { getAuthAccessToken } from './useAuthSession'
import { apiUrl } from '../lib/api-base'

const ADMIN_REQUEST_TIMEOUT_MS = 15_000

export async function adminApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthAccessToken()
  if (!token) throw new Error('请先登录。')

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
    throw new Error(typeof data?.error === 'string' ? data.error : '请求失败')
  }
  return data as T
}
