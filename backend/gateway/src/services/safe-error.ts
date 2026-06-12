import {
  IMAGE_GEN_API_KEY,
  IMAGE_GEN_BASE_URL,
  KIMI_API_KEY,
  KIMI_BASE_URL,
  NVIDIA_API_KEY,
  NVIDIA_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  TENCENT_COS_PUBLIC_BASE_URL,
  TENCENT_COS_SECRET_ID,
  TENCENT_COS_SECRET_KEY,
} from '../config.js'

const REDACTED_SECRET = '[redacted-secret]'
const REDACTED_URL = '[redacted-url]'
const REDACTED_HOST = '[redacted-host]'

function configuredSecrets() {
  return [
    IMAGE_GEN_API_KEY,
    OPENAI_API_KEY,
    KIMI_API_KEY,
    NVIDIA_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_PUBLISHABLE_KEY,
    TENCENT_COS_SECRET_ID,
    TENCENT_COS_SECRET_KEY,
  ].filter((value): value is string => Boolean(value && value.length >= 6))
}

function configuredHosts() {
  return [
    IMAGE_GEN_BASE_URL,
    OPENAI_BASE_URL,
    KIMI_BASE_URL,
    NVIDIA_BASE_URL,
    SUPABASE_URL,
    TENCENT_COS_PUBLIC_BASE_URL,
  ]
    .map((value) => {
      try {
        return value ? new URL(value).hostname : ''
      } catch {
        return value || ''
      }
    })
    .filter((value): value is string => Boolean(value && value.length >= 4))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactSensitiveText(value: unknown) {
  let text = ''
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  if (!text) return ''

  for (const secret of configuredSecrets()) {
    text = text.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED_SECRET)
  }

  for (const host of configuredHosts()) {
    text = text.replace(new RegExp(escapeRegExp(host), 'gi'), REDACTED_HOST)
  }

  return text
    .replace(/https?:\/\/[^\s"'<>)}\]]+/gi, REDACTED_URL)
    .replace(/https?:\\\/\\\/[^\s"'<>)}\]]+/gi, REDACTED_URL)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\b\s*[:=]\s*["']?[^"',\s)}\]]+/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\b(sk|rk|pk|nvapi)-[A-Za-z0-9_-]{12,}\b/g, REDACTED_SECRET)
    .replace(/\b[A-Za-z0-9_-]{48,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, REDACTED_SECRET)
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, REDACTED_SECRET)
}

export function safeErrorDetail(error: unknown, fallback = 'unknown error') {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(error)
  const redacted = redactSensitiveText(raw || fallback)
    .replace(/\s+/g, ' ')
    .trim()
  return redacted || fallback
}

export function publicErrorMessage(
  error: unknown,
  fallback = '请求失败，请稍后重试。',
) {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined
  if (status === 408 || status === 524 || /timeout|aborted|timed out|超时/i.test(String((error as any)?.message || ''))) {
    return '服务响应超时，请稍后重试。'
  }
  if (status === 429) return '请求过于频繁，请稍后重试。'
  if (status === 401 || status === 403) return '服务暂时无法处理该请求，请稍后重试。'
  if (status && status >= 500) return '服务暂时不可用，请稍后重试。'
  if (/upstream|provider|service temporarily unavailable|upstream request failed|Responses API|Images API/i.test(String((error as any)?.message || error || ''))) {
    return '服务暂时不可用，请稍后重试。'
  }
  return fallback
}
