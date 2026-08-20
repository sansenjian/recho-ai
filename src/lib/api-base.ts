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

function isIdempotentMethod(method?: string): boolean {
  const m = (method || 'GET').toUpperCase()
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
}

// 退避等待期间监听 signal：请求被取消时立即以 AbortError 中止，而不是干等完整休眠时长。
function sleep(ms: number, signal: AbortSignal | null | undefined) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // 仅对幂等且不带请求体的请求（GET/HEAD/OPTIONS）自动重试：
  // - 非幂等请求（如 POST 上传）重试可能产生重复副作用；
  // - 带请求体的请求可能是流式/一次性 body，重试时请求体已被消费，无法安全复用同一 RequestInit。
  // 因此带 body 的请求一律不重试。
  const canRetry = isIdempotentMethod(init.method) && !init.body
  let lastResponse: Response | undefined
  let lastError: unknown

  for (let attempt = 0; attempt <= HIBERNATE_RETRY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      await sleep(HIBERNATE_RETRY_DELAYS_MS[attempt - 1] ?? HIBERNATE_RETRY_DELAYS_MS[0], init.signal)
    }
    try {
      const response = await fetch(url, init)
      if (canRetry && attempt < HIBERNATE_RETRY_ATTEMPTS && response.status === 503) {
        lastResponse = response
        continue
      }
      return response
    } catch (error) {
      if (isAbortError(error)) throw error
      // 真实网络类失败（如跨域打到休眠实例）以 TypeError 形式出现，
      // 普通业务错误不应触发重试。
      if (!canRetry || !(error instanceof TypeError)) throw error
      lastError = error
      if (attempt >= HIBERNATE_RETRY_ATTEMPTS) throw error
    }
  }

  if (lastResponse) return lastResponse
  throw lastError
}
