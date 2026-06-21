function objectRecord(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
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
  const directMessage = record?.error || record?.message
  if (typeof directMessage === 'string' && directMessage.trim()) return directMessage

  const nestedMessage = objectRecord(record?.error)?.message
  if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage

  return body.toString('utf8').trim().slice(0, 1200) || 'Go image generation failed'
}
