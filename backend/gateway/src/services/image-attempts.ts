import { getSupabaseAdminClient } from '../clients/supabase.js'

const IMAGE_ATTEMPTS_TABLE = 'image_generation_attempts'

export interface ImageGenerationAttempt {
  generationId?: string | null
  userId?: string | null
  provider?: string | null
  imageModel?: string | null
  textModel?: string | null
  status: 'succeeded' | 'failed'
  latencyMs?: number | null
  errorType?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  httpStatus?: number | null
  requestId?: string | null
  requestIp?: string | null
  requestUserAgent?: string | null
}

function compactMessage(value?: string | null) {
  if (!value) return null
  return value.replace(/\s+/g, ' ').trim().slice(0, 1200) || null
}

export async function recordImageGenerationAttempt(attempt: ImageGenerationAttempt) {
  const client = getSupabaseAdminClient()
  if (!client) return false

  const row = {
    generation_id: attempt.generationId || null,
    user_id: attempt.userId || null,
    provider: attempt.provider || null,
    image_model: attempt.imageModel || null,
    text_model: attempt.textModel || null,
    status: attempt.status,
    latency_ms: typeof attempt.latencyMs === 'number' ? Math.max(0, Math.round(attempt.latencyMs)) : null,
    error_type: attempt.errorType || null,
    error_code: attempt.errorCode || null,
    error_message: compactMessage(attempt.errorMessage),
    http_status: typeof attempt.httpStatus === 'number' ? attempt.httpStatus : null,
    request_id: attempt.requestId || null,
    request_ip: attempt.requestIp || null,
    request_user_agent: attempt.requestUserAgent || null,
  }

  const { error } = await client
    .from(IMAGE_ATTEMPTS_TABLE)
    .insert(row)

  if (error) {
    console.warn('[image-attempts] record skipped:', error.message)
    return false
  }

  return true
}
