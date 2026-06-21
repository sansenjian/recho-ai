function objectRecord(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export const IMAGE_ATTEMPT_RESPONSE_BUFFER_MAX_BYTES = 1024 * 1024

export function imageAttemptContentLength(value?: string | null) {
  if (!value) return null
  const length = Number(value)
  if (!Number.isFinite(length) || length < 0) return null
  return Math.floor(length)
}

function isJSONContentType(value?: string | null) {
  const contentType = value?.toLowerCase() || ''
  return contentType.includes('application/json') || contentType.includes('+json')
}

export function shouldBufferImageAttemptBody(
  contentType?: string | null,
  contentLength?: string | null,
  maxBytes = IMAGE_ATTEMPT_RESPONSE_BUFFER_MAX_BYTES,
) {
  const length = imageAttemptContentLength(contentLength)
  return isJSONContentType(contentType) && length !== null && length <= maxBytes
}

export function parseImageAttemptResponseJSON(body: Buffer) {
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    return null
  }
}

export function imageAttemptErrorType(status: number) {
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'credits'
  if (status >= 500) return 'provider'
  return 'request'
}

export function firstImageID(value: unknown) {
  const images = objectRecord(value)?.images
  if (!Array.isArray(images)) return null

  const id = objectRecord(images[0])?.id
  return typeof id === 'string' && id ? id : null
}

export function responseErrorMessage(value: unknown, body: Buffer) {
  const record = objectRecord(value)
  const message = record?.message
  if (typeof message === 'string' && message.trim()) return message

  const error = record?.error
  if (typeof error === 'string' && error.trim()) return error

  const nestedMessage = objectRecord(error)?.message
  if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage

  return body.toString('utf8').trim().slice(0, 1200) || 'Go image generation failed'
}
