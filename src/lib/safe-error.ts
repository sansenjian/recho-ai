const REDACTED_SECRET = '[redacted-secret]'
const REDACTED_URL = '[redacted-url]'
const REDACTED_HOST = '[redacted-host]'

function rawErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function redactSensitiveClientText(value: unknown) {
  return rawErrorMessage(value)
    .replace(/https?:\/\/[^\s"'<>)}\]]+/gi, REDACTED_URL)
    .replace(/https?:\\\/\\\/[^\s"'<>)}\]]+/gi, REDACTED_URL)
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, REDACTED_HOST)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\b\s*[:=]\s*["']?[^"',\s)}\]]+/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\b(sk|rk|pk|nvapi)-[A-Za-z0-9_-]{12,}\b/g, REDACTED_SECRET)
    .replace(/\b[A-Za-z0-9_-]{48,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, REDACTED_SECRET)
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, REDACTED_SECRET)
    .replace(/\s+/g, ' ')
    .trim()
}

export function publicClientErrorMessage(error: unknown, fallback = '请求失败，请稍后重试。') {
  const message = rawErrorMessage(error)

  if (/AbortError|timeout|timed out|aborted|超时/i.test(message)) {
    return '服务响应超时，请稍后重试。'
  }

  if (/Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|Load failed|network/i.test(message)) {
    return '网络连接异常，请稍后重试。'
  }

  if (/Responses API|Images API|upstream|provider|Service temporarily unavailable|Upstream request failed|502|503|504/i.test(message)) {
    return '图片生成服务暂时不可用，请稍后重试。'
  }

  const redacted = redactSensitiveClientText(message)
  if (!redacted || /\[redacted-(secret|url|host)\]/.test(redacted)) return fallback
  return redacted.slice(0, 180)
}
