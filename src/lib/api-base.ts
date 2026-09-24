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
  // 幂等读请求（GET/HEAD/OPTIONS、无 body）在并发场景下共享同一支 in-flight 请求，
  // 避免组件重复挂载 / 快速切页时对同一接口发起重复请求（见 weak-network-optimization-plan §3）。
  // 原则：仅对"可重用"读接口去重；显式 cache: 'no-store'（如历史列表，需保新鲜）不去重。
  const dedupeKey = dedupeFetchKey(url, init)
  if (dedupeKey) {
    return dedupeSharedRequest(dedupeKey, url, init)
  }
  return performFetch(url, init)
}

// ---------------------------------------------------------------------------
// In-flight 去重
// ---------------------------------------------------------------------------

interface SharedRequest {
  promise: Promise<MaterializedResponse>
  refs: number
  controller?: AbortController
}

interface MaterializedResponse {
  status: number
  statusText: string
  headers: Headers
  body: ArrayBuffer
}

const inflightShared = new Map<string, SharedRequest>()

// 返回去重 key；不满足去重条件（写请求、带 body、非默认缓存模式、带影响响应的选项）返回 null。
function dedupeFetchKey(url: string, init: RequestInit): string | null {
  if (!isIdempotentMethod(init.method)) return null
  if (init.body) return null
  // 仅默认缓存模式参与去重：no-store / force-cache / reload / no-cache 等对缓存行为
  // 有显式要求，若与默认请求合并，要求重新加载（reload/no-cache）的调用方会拿到旧缓存结果。
  if (init.cache !== undefined && init.cache !== 'default') return null
  // 请求头（如 Authorization）或凭据模式会影响响应，不能只按 URL 共享：
  // 否则带 token 的调用可能复用无 token 的响应，切换账号时也可能串数据。
  if (init.headers && [...new Headers(init.headers).keys()].length > 0) return null
  if (init.credentials || init.mode || init.redirect || init.integrity) return null
  return `${(init.method || 'GET').toUpperCase()} ${url}`
}

// 同 key 并发时复用唯一一次底层 fetch，并把响应体物化后返回独立副本，
// 保证每个调用方都能读取自己的 Response body（底层 body 只读一次）。
async function dedupeSharedRequest(
  key: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const signal = init.signal
  const existing = inflightShared.get(key)
  if (existing) {
    existing.refs += 1
    try {
      const materialized = await withAbort(existing.promise, signal)
      return materializeResponse(materialized)
    } finally {
      releaseSharedRef(key, existing)
    }
  }

  // 共享请求使用内部 AbortController，而不是复用首个调用方的 signal：
  // 任一调用方（哪怕第一个）中止，都只中断它自己，不影响其他共享调用方。
  const controller = new AbortController()
  const entry: SharedRequest = {
    refs: 1,
    promise: performFetch(url, { ...init, signal: controller.signal }).then(async (response) => {
      const body = await response.arrayBuffer()
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body,
      }
    }),
    controller,
  }
  inflightShared.set(key, entry)
  try {
    const materialized = await withAbort(entry.promise, signal)
    return materializeResponse(materialized)
  } finally {
    releaseSharedRef(key, entry)
  }
}

function releaseSharedRef(key: string, entry: SharedRequest) {
  entry.refs -= 1
  if (entry.refs <= 0 && inflightShared.get(key) === entry) {
    // 全部调用方已结束，中止共享请求并清理，避免泄漏。
    entry.controller?.abort()
    inflightShared.delete(key)
  }
}

// 每个调用方拿一份独立 body 副本，避免共享 Response 导致 body 被读两次。
// 204/205/304 等 null-body 状态码必须传 null body，否则 new Response 抛 TypeError。
function materializeResponse(materialized: MaterializedResponse): Response {
  const nullBodyStatus = [101, 103, 204, 205, 304].includes(materialized.status)
  const body = nullBodyStatus ? null : materialized.body.slice(0)
  return new Response(body, {
    status: materialized.status,
    statusText: materialized.statusText,
    headers: materialized.headers,
  })
}

// 去重共享期间，任意调用方各自的 abort signal 只中断它自己，不影响共享请求本身。
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

// 实际执行（含休眠唤醒退避重试）。
async function performFetch(url: string, init: RequestInit): Promise<Response> {
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
