import dotenv from 'dotenv'
dotenv.config()

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
