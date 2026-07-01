import dotenv from 'dotenv'
import { normalizeImageCreditCostPerImage } from './services/image-credit-cost.js'
dotenv.config({ override: true })

export function resolveTencentCosBucket(bucket: string, appId: string) {
  const normalizedBucket = bucket.trim()
  const normalizedAppId = appId.trim()
  if (!normalizedBucket) return ''
  if (!normalizedAppId || normalizedBucket.endsWith(`-${normalizedAppId}`)) return normalizedBucket
  return `${normalizedBucket}-${normalizedAppId}`
}

export const PORT = parseInt(process.env.PORT || '3000', 10)
export const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export const NVIDIA_RPM = 40
export const STREAM_TIMEOUT_MS = 5 * 60 * 1000
export const STREAM_START_TIMEOUT_MS = 15_000
export const MAX_TOOL_ROUNDS = 5
export const ACQUIRE_TIMEOUT_MS = 30_000
export const OPENAI_TIMEOUT_MS = 60_000

export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || ''
export const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1'

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL

export const KIMI_API_KEY = process.env.KIMI_API_KEY
export const KIMI_BASE_URL = process.env.KIMI_BASE_URL

export const PROVIDER_API_KEY_MASTER_KEY = process.env.PROVIDER_API_KEY_MASTER_KEY ||
  process.env.API_KEY_MASTER_KEY ||
  process.env.API_KEY_ENCRYPTION_KEY ||
  ''

export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
export const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.UPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const SUPABASE_IMAGE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET || 'recho-images'

export const TENCENT_COS_SECRET_ID = process.env.TENCENT_COS_SECRET_ID || ''
export const TENCENT_COS_SECRET_KEY = process.env.TENCENT_COS_SECRET_KEY || ''
export const TENCENT_COS_BUCKET = process.env.TENCENT_COS_BUCKET || ''
export const TENCENT_COS_APPID = process.env.TENCENT_COS_APPID || ''
export const TENCENT_COS_FULL_BUCKET = resolveTencentCosBucket(TENCENT_COS_BUCKET, TENCENT_COS_APPID)
export const TENCENT_COS_REGION = process.env.TENCENT_COS_REGION || ''
export const TENCENT_COS_PUBLIC_BASE_URL = process.env.TENCENT_COS_PUBLIC_BASE_URL || ''
export const IMAGE_PROXY_RATE_LIMIT_WINDOW_MS = parseInt(process.env.IMAGE_PROXY_RATE_LIMIT_WINDOW_MS || '60000', 10)
export const IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS || '120', 10)
export const IMAGE_PROXY_RATE_LIMIT_MAX_BYTES = parseInt(process.env.IMAGE_PROXY_RATE_LIMIT_MAX_BYTES || String(30 * 1024 * 1024), 10)

export const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
export const ADMIN_USER_EMAILS = (process.env.ADMIN_USER_EMAILS || '')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean)

export const IMAGE_GEN_API_KEY = process.env.IMAGE_GEN_API_KEY || ''
export const IMAGE_GEN_BASE_URL = process.env.IMAGE_GEN_BASE_URL || 'https://lucen.plus/v1'
export const IMAGE_CREDIT_COST_PER_IMAGE = normalizeImageCreditCostPerImage(process.env.IMAGE_CREDIT_COST_PER_IMAGE)
export const IMAGE_RESPONSES_MODEL = process.env.IMAGE_RESPONSES_MODEL || 'gpt-image-2'
export const IMAGE_RESPONSES_IMAGE_MODEL = process.env.IMAGE_RESPONSES_IMAGE_MODEL || 'gpt-image-2'

export const IMAGE_ANALYTICS_ENABLED = process.env.IMAGE_ANALYTICS_ENABLED === 'true'
export const IMAGE_EVENTS_ENABLED = process.env.IMAGE_EVENTS_ENABLED === 'true'
export const CANVAS_CONTEXT_ENABLED = process.env.CANVAS_CONTEXT_ENABLED === 'true'

export const FREE_GENERATION_ENABLED = process.env.FREE_GENERATION_ENABLED !== 'false'
export const GUEST_GENERATION_ENABLED = process.env.GUEST_GENERATION_ENABLED !== 'false'
