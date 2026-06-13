/**
 * Pure functions for image generation API calls.
 * These functions have no side effects and depend only on their inputs.
 */

import { IMAGE_GEN_API_KEY, IMAGE_GEN_BASE_URL } from '../config.js'
import { safeErrorDetail } from './safe-error.js'

export type ImageAspectRatio = 'auto' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16'
export type ImageResolution = 'auto' | '1k' | '2k' | '4k'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type ImageGenerationCount = 1 | 2 | 4 | 8

export interface ImageProviderResponse {
  provider: string
  imageModel: string
  textModel?: string
  data?: Array<{
    b64_json?: string | null
    url?: string | null
    revised_prompt?: string | null
  }>
  output?: unknown
}

export interface ImageSource {
  buffer: Buffer
  mime: string
}

export interface ImageGenReference {
  id?: string
  title?: string
  dataUrl?: string
  storagePath?: string
  previewUrl?: string
  previewPath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  content?: string
  fileName?: string
}

export const IMAGE_REQUEST_TIMEOUT_MS = 360_000
export const IMAGE_RETRY_TIMES = 3

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateGptImage2Size(size: string): string | null {
  if (size === 'auto') return null
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(size)
  if (!match) return 'size must be auto or WIDTHxHEIGHT, for example 1024x1024.'

  const width = Number(match[1])
  const height = Number(match[2])
  const maxEdge = Math.max(width, height)
  const minEdge = Math.min(width, height)
  const totalPixels = width * height

  if (maxEdge > 3840) return 'gpt-image-2 size maximum edge length must be less than or equal to 3840px.'
  if (width % 16 !== 0 || height % 16 !== 0) return 'gpt-image-2 size width and height must be multiples of 16px.'
  if (maxEdge / minEdge > 3) return 'gpt-image-2 size long edge to short edge ratio must not exceed 3:1.'
  if (totalPixels < 655_360 || totalPixels > 8_294_400) {
    return 'gpt-image-2 size total pixels must be at least 655,360 and no more than 8,294,400.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Size mapping
// ---------------------------------------------------------------------------

export const sizeByResolution: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  auto: {
    auto: 'auto',
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1536x864',
    '9:16': '864x1536',
  },
  '1k': {
    auto: '1024x1024',
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1536x864',
    '9:16': '864x1536',
  },
  '2k': {
    auto: '2048x2048',
    '1:1': '2048x2048',
    '3:2': '2160x1440',
    '2:3': '1440x2160',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
  },
  '4k': {
    auto: '3840x2160',
    '1:1': '2880x2880',
    '3:2': '3520x2336',
    '2:3': '2336x3520',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
  },
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function apiUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return base.endsWith('/v1') ? `${base}${cleanPath}` : `${base}/v1${cleanPath}`
}

export function providerName(): string {
  try {
    const host = new URL(IMAGE_GEN_BASE_URL).hostname
    return host.replace(/^api\./, '')
  } catch {
    return IMAGE_GEN_BASE_URL || 'unknown'
  }
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export function imageRequestFields(
  prompt: string,
  size: string,
  quality: ImageQuality,
  count: ImageGenerationCount,
  imageModel: string,
) {
  return {
    model: imageModel,
    prompt,
    n: count,
    ...(size === 'auto' ? {} : { size }),
    ...(quality === 'auto' ? {} : { quality }),
  }
}

// ---------------------------------------------------------------------------
// Error utilities
// ---------------------------------------------------------------------------

export function isRetryableStatus(status?: number) {
  return status === 408 || status === 429 || (typeof status === 'number' && status >= 500)
}

export function compactErrorText(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

export function providerErrorMessage(prefix: string, status: number, text: string) {
  if (status === 524) {
    return `${prefix} 524: 当前生图服务源站处理超时，Cloudflare 已放弃等待。请求已到达外部服务，但上游没有及时返回。`
  }
  return `${prefix} ${status}: ${safeErrorDetail(compactErrorText(text), 'provider error')}`
}

// ---------------------------------------------------------------------------
// Image source conversion
// ---------------------------------------------------------------------------

export function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl)
  if (!match) return null
  const mime = match[1] || 'image/png'
  const payload = match[3] || ''
  const buffer = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))
  return { mime, buffer }
}

export function dataUrlToImageSource(dataUrl: string): ImageSource | null {
  return parseDataUrl(dataUrl)
}

export function b64JsonToImageSource(b64Json: string): ImageSource | null {
  const cleanB64 = b64Json.trim()
  if (!cleanB64) return null
  if (/^data:image\//i.test(cleanB64)) return dataUrlToImageSource(cleanB64)

  const buffer = Buffer.from(cleanB64.replace(/\s/g, ''), 'base64')
  if (!buffer.byteLength) return null
  return { buffer, mime: 'image/png' }
}

export async function imageUrlToImageSource(url: string): Promise<ImageSource> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) {
    throw Object.assign(new Error(`生成图片下载失败 ${response.status}`), { status: response.status })
  }
  const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, mime }
}

export async function normalizeGeneratedImageSource(value: string): Promise<ImageSource | null> {
  const source = value.trim()
  if (!source) return null
  if (/^data:image\//i.test(source)) return dataUrlToImageSource(source)
  if (!/^https?:\/\//i.test(source)) {
    throw Object.assign(new Error('generated image source is not a valid image URL'), { status: 502 })
  }

  try {
    return await imageUrlToImageSource(source)
  } catch (err: any) {
    console.warn('[image] generated image url download failed:', safeErrorDetail(err))
    throw Object.assign(new Error('generated image download failed'), { status: err?.status || 502 })
  }
}

export function imageSourceToDataUrl(source?: ImageSource | null) {
  if (!source?.buffer?.byteLength) return null
  return `data:${source.mime || 'image/png'};base64,${source.buffer.toString('base64')}`
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function collectImageGenerationResults(value: unknown, results: string[] = []): string[] {
  if (!value) return results
  if (Array.isArray(value)) {
    for (const item of value) collectImageGenerationResults(item, results)
    return results
  }
  if (typeof value !== 'object') return results

  const record = value as Record<string, unknown>
  for (const key of ['b64_json', 'partial_image_b64', 'result', 'image_b64']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      results.push(candidate.trim())
    }
  }
  for (const item of Object.values(record)) collectImageGenerationResults(item, results)
  return results
}

export async function parseImagesApiResponse(response: globalThis.Response, prefix: string) {
  const text = await response.text()
  if (!response.ok) {
    throw Object.assign(
      new Error(providerErrorMessage(prefix, response.status, text)),
      { status: response.status },
    )
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${prefix}: 上游返回了无法解析的 JSON: ${compactErrorText(text)}`)
  }
}

// ---------------------------------------------------------------------------
// Reference processing helpers (pure string utilities)
// ---------------------------------------------------------------------------

export function extensionForMime(mime: string) {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

export function safeUploadName(reference: ImageGenReference, index: number, mime: string) {
  const rawName = reference.fileName || reference.title || `image_${index + 1}`
  const stem = rawName.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)
  return `${stem || `image_${index + 1}`}.${extensionForMime(mime)}`
}
