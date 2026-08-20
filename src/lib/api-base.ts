function isLocalDevHost() {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(window.location.hostname)
}

export function apiBaseUrl() {
  if (import.meta.env.DEV && isLocalDevHost() && import.meta.env.VITE_FORCE_REMOTE_API !== 'true') {
    return ''
  }

  return String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
}

export function apiUrl(path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${apiBaseUrl()}${cleanPath}`
}

export function imageApiBaseUrl() {
  const imageBase = String(import.meta.env.VITE_IMAGE_API_BASE_URL || '').trim().replace(/\/+$/, '')
  return imageBase || apiBaseUrl()
}

export function imageApiUrl(path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${imageApiBaseUrl()}${cleanPath}`
}

// 免费期 Render 网关闲置后休眠，冷启动前收到的首个跨域请求会返回 503
// （x-render-routing: hibernate-wake-error）或直接网络失败，浏览器因此误报为
// CORS 错误。这里对这类"休眠唤醒中"的失败做几次退避重试，等冷启动完成。
const HIBERNATE_RETRY_ATTEMPTS = 3
const HIBERNATE_RETRY_DELAYS_MS = [1500, 3000, 5000]

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let lastResponse: Response | undefined
  let lastError: unknown

  for (let attempt = 0; attempt <= HIBERNATE_RETRY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      await sleep(HIBERNATE_RETRY_DELAYS_MS[attempt - 1] ?? HIBERNATE_RETRY_DELAYS_MS[0])
    }
    try {
      lastResponse = await fetch(url, init)
      if (attempt < HIBERNATE_RETRY_ATTEMPTS && lastResponse.status === 503) {
        continue
      }
      return lastResponse
    } catch (error) {
      if (isAbortError(error)) throw error
      // 真实网络类失败（如跨域打到休眠实例）以 TypeError 形式出现，
      // 普通业务错误不应触发重试。
      if (!(error instanceof TypeError)) throw error
      lastError = error
      if (attempt >= HIBERNATE_RETRY_ATTEMPTS) throw error
    }
  }

  if (lastResponse) return lastResponse
  throw lastError
}
