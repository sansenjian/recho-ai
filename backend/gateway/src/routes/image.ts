import { Router, Request, Response, raw } from 'express'
import { randomUUID } from 'node:crypto'
import {
  IMAGE_PROXY_RATE_LIMIT_MAX_BYTES,
  IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS,
  IMAGE_PROXY_RATE_LIMIT_WINDOW_MS,
} from '../config.js'
import { recordImageGenerationContext, type ImageCanvasContext } from '../services/image-analytics.js'
import { getAppSettings } from '../services/app-settings.js'
import { recordImageGenerationAttempt } from '../services/image-attempts.js'
import { saveImageHistory, type ImageHistoryItem } from '../services/image-history.js'
import { downloadImageBuffer, storeImageBuffer } from '../services/image-storage.js'
import { getRequestUserId } from '../services/request-auth.js'
import { requestIp, requestUserAgent } from '../services/request-ip.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'
import { CreditError, refundUserCredits, reserveUserCredits, type CreditReservation } from '../services/credits.js'
import { imageCreditCost } from '../services/image-credit-cost.js'
import {
  type ImageAspectRatio,
  type ImageResolution,
  type ImageQuality,
  type ImageGenerationCount,
  type ImageGenReference,
  type ImageProviderResponse,
  type ImageSource,
  validateGptImage2Size,
  sizeByResolution,
  isRetryableStatus,
  parseDataUrl,
  b64JsonToImageSource,
  normalizeGeneratedImageSource,
  imageSourceToDataUrl,
  collectImageGenerationResults,
  parseImagesApiResponse,
  providerErrorMessage,
  compactErrorText,
  apiUrl,
  providerName,
  extensionForMime,
  safeUploadName,
  IMAGE_REQUEST_TIMEOUT_MS,
  IMAGE_RETRY_TIMES,
} from '../services/image-api.js'

const router = Router()

const REFERENCE_UPLOAD_LIMIT = '12mb'
const REFERENCE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024
const REFERENCE_UPLOAD_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
const IMAGE_PROXY_THUMBNAIL_ESTIMATE_BYTES = 512 * 1024
const IMAGE_PROXY_PREVIEW_ESTIMATE_BYTES = 2 * 1024 * 1024
const IMAGE_PROXY_ORIGINAL_ESTIMATE_BYTES = 8 * 1024 * 1024
// Per-process fallback limiter for single-instance gateway deployments. Use a shared store if Render scales to multiple instances.
const imageProxyIpBuckets = new Map<string, { resetAt: number; requests: number; bytes: number }>()

const aspectRatios = new Set<ImageAspectRatio>(['auto', '1:1', '3:2', '2:3', '16:9', '9:16'])
const resolutions = new Set<ImageResolution>(['auto', '1k', '2k', '4k'])
const qualities = new Set<ImageQuality>(['auto', 'low', 'medium', 'high'])
const imageGenerationCounts = new Set<ImageGenerationCount>([1, 2, 4, 8])

interface ImageGenRequest {
  prompt: string
  displayPrompt?: string
  userPrompt?: string
  systemPrompt?: string
  modelPrompt?: string
  size?: string
  aspectRatio?: ImageAspectRatio
  resolution?: ImageResolution
  quality?: ImageQuality
  count?: ImageGenerationCount
  references?: ImageGenReference[]
  canvasContext?: ImageCanvasContext
}

function normalizeOption<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback
}

function normalizeImageGenerationCount(value: unknown): ImageGenerationCount {
  const count = Number(value)
  return imageGenerationCounts.has(count as ImageGenerationCount) ? count as ImageGenerationCount : 1
}

function shortPrompt(value: string) {
  return `${value.slice(0, 80)}${value.length > 80 ? '...' : ''}`
}

function requestText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isSystemPromptBlock(block: string) {
  return (
    /^已上传 \d+ 张真实参考图/.test(block) &&
    block.includes('不要只根据文字重新想象')
  ) || /^.+: 第 \d+ 张参考图/.test(block)
}

function stripSystemPromptBlocks(prompt: string) {
  const visibleBlocks = prompt
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .filter(block => !isSystemPromptBlock(block))

  return visibleBlocks.join('\n\n') || prompt
}

function publicHistoryImage(image: ImageHistoryItem) {
  const {
    requestIp: _requestIp,
    requestUserAgent: _requestUserAgent,
    provider: _provider,
    imageModel: _imageModel,
    textModel: _textModel,
    latencyMs: _latencyMs,
    creditTransactionId: _creditTransactionId,
    sourceBuffer: _sourceBuffer,
    sourceMime: _sourceMime,
    dataUrl,
    ...publicImage
  } = image
  const hasViewingUrl = Boolean(publicImage.previewUrl || publicImage.thumbnailUrl)
  return {
    ...publicImage,
    ...(!hasViewingUrl && dataUrl ? { dataUrl } : {}),
  }
}

function warnRejectedSideEffects(label: string, results: PromiseSettledResult<unknown>[]) {
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`${label} record skipped:`, safeErrorDetail(result.reason))
    }
  }
}

function recordSuccessfulImageGenerationSideEffects(options: {
  images: ImageHistoryItem[]
  userId: string | null
  provider: string
  imageModel: string
  textModel?: string
  latencyMs: number
  requestIp: string | null
  requestUserAgent: string | null
  canvasContext: unknown
}) {
  const attemptRecords = Promise.allSettled(options.images.map(image => recordImageGenerationAttempt({
    generationId: image.id,
    userId: options.userId,
    provider: options.provider,
    imageModel: options.imageModel,
    textModel: options.textModel,
    status: 'succeeded',
    latencyMs: options.latencyMs,
    requestIp: options.requestIp,
    requestUserAgent: options.requestUserAgent,
  }))).then(results => warnRejectedSideEffects('[image-attempts]', results))

  const contextRecords = Promise.allSettled(
    options.images.map(image => recordImageGenerationContext(image.id, options.userId, options.canvasContext)),
  ).then(results => warnRejectedSideEffects('[image-contexts]', results))

  void Promise.all([attemptRecords, contextRecords]).catch((err) => {
    console.warn('[image] post-generation records skipped:', safeErrorDetail(err))
  })
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorType(err: any) {
  if (err instanceof CreditError) return 'credits'
  if (typeof err?.status === 'number') {
    if (err.status === 401 || err.status === 403) return 'auth'
    if (err.status === 408 || err.status === 524) return 'timeout'
    if (err.status === 429) return 'rate_limit'
    if (err.status >= 500) return 'provider'
    return 'request'
  }
  if (err?.name === 'TimeoutError' || /timeout|aborted|timed out/i.test(err?.message || '')) return 'timeout'
  return 'unknown'
}

function publicImageErrorMessage(err: any, fallback = '图片生成失败，请稍后重试。') {
  if (typeof err?.publicMessage === 'string' && err.publicMessage) return err.publicMessage
  return publicErrorMessage(err, fallback)
}

function canGeneratePublicAfterCreditError(err: unknown) {
  if (!(err instanceof CreditError)) return false
  return err.code === 'insufficient_credits' || err.code === 'credit_operation_failed' || err.code === 'service_unavailable'
}

function safeProxyStoragePath(value: unknown) {
  if (typeof value !== 'string') return null
  let path = value
  try {
    path = decodeURIComponent(value)
  } catch {
    return null
  }
  path = path.trim()
  if (!path || /^https?:\/\//i.test(path) || /^data:/i.test(path)) return null
  const normalized = path.startsWith('cos://') ? path.slice('cos://'.length) : path
  if (!normalized || normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) return null
  return path
}

function imageProxyRateLimitKey(req: Request) {
  return requestIp(req) || req.socket.remoteAddress || 'unknown'
}

function imageProxyBucket(req: Request) {
  const now = Date.now()
  const key = imageProxyRateLimitKey(req)
  let bucket = imageProxyIpBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { resetAt: now + IMAGE_PROXY_RATE_LIMIT_WINDOW_MS, requests: 0, bytes: 0 }
    imageProxyIpBuckets.set(key, bucket)
  }

  pruneImageProxyBuckets(now)
  return bucket
}

function reserveImageProxyRequest(req: Request) {
  const bucket = imageProxyBucket(req)
  bucket.requests += 1
  return bucket.requests <= IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS
}

function reserveImageProxyBytes(req: Request, bytes: number) {
  const bucket = imageProxyBucket(req)
  const reservedBytes = Math.max(0, bytes)
  if (bucket.bytes + reservedBytes > IMAGE_PROXY_RATE_LIMIT_MAX_BYTES) return false
  bucket.bytes += reservedBytes
  return true
}

function releaseImageProxyBytes(req: Request, bytes: number) {
  const bucket = imageProxyBucket(req)
  bucket.bytes = Math.max(0, bucket.bytes - Math.max(0, bytes))
}

function estimateImageProxyBytes(storagePath: string) {
  if (/\.thumb\.webp$/i.test(storagePath)) return IMAGE_PROXY_THUMBNAIL_ESTIMATE_BYTES
  if (/\.preview\.webp$/i.test(storagePath)) return IMAGE_PROXY_PREVIEW_ESTIMATE_BYTES
  return Math.min(IMAGE_PROXY_ORIGINAL_ESTIMATE_BYTES, IMAGE_PROXY_RATE_LIMIT_MAX_BYTES)
}

function settleImageProxyBytes(req: Request, reservedBytes: number, actualBytes: number) {
  const reserved = Math.max(0, reservedBytes)
  const actual = Math.max(0, actualBytes)
  if (actual <= reserved) {
    releaseImageProxyBytes(req, reserved - actual)
    return true
  }
  return reserveImageProxyBytes(req, actual - reserved)
}

function pruneImageProxyBuckets(now = Date.now()) {
  if (imageProxyIpBuckets.size <= 10_000) return
  for (const [key, bucket] of imageProxyIpBuckets) {
    if (bucket.resetAt <= now) imageProxyIpBuckets.delete(key)
    if (imageProxyIpBuckets.size <= 10_000) return
  }
}

function headerText(value: unknown, maxLength = 120) {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return ''
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }

  return decoded
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function requestContentType(req: Request) {
  const mime = req.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream'
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

function isAllowedReferenceMime(mime: string) {
  return REFERENCE_UPLOAD_MIME_TYPES.has(mime)
}

function safePathPart(value: string, fallback: string) {
  const safe = value
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return safe || fallback
}

function referencesForHistory(references: ImageGenReference[]) {
  return references.map((reference, index) => ({
    id: reference.id ? String(reference.id) : `reference_${index + 1}`,
    title: reference.title ? String(reference.title) : `参考图${index + 1}`,
    ...(reference.dataUrl ? { dataUrl: String(reference.dataUrl) } : {}),
    ...(reference.storagePath ? { storagePath: String(reference.storagePath) } : {}),
    ...(reference.previewUrl ? { previewUrl: String(reference.previewUrl) } : {}),
    ...(reference.previewPath ? { previewPath: String(reference.previewPath) } : {}),
    ...(reference.thumbnailUrl ? { thumbnailUrl: String(reference.thumbnailUrl) } : {}),
    ...(reference.thumbnailPath ? { thumbnailPath: String(reference.thumbnailPath) } : {}),
    content: reference.content ? String(reference.content) : undefined,
    fileName: reference.fileName ? String(reference.fileName) : undefined,
  }))
}

async function referenceToBlob(reference: ImageGenReference, index: number) {
  let mime = 'image/png'
  let buffer: Buffer

  if (reference.storagePath) {
    const source = await downloadImageBuffer(reference.storagePath)
    if (!source?.buffer.byteLength) {
      throw Object.assign(new Error(`参考图 ${reference.title || index + 1} 读取失败`), { status: 400 })
    }
    mime = source.mime
    buffer = source.buffer
  } else if (reference.dataUrl) {
    const parsed = parseDataUrl(reference.dataUrl)
    if (parsed) {
      mime = parsed.mime
      buffer = parsed.buffer
    } else if (/^https?:\/\//i.test(reference.dataUrl)) {
      const response = await fetch(reference.dataUrl, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) {
        throw Object.assign(new Error(`参考图下载失败 ${response.status}: ${compactErrorText(await response.text())}`), { status: response.status })
      }
      mime = response.headers.get('content-type')?.split(';')[0] || mime
      buffer = Buffer.from(await response.arrayBuffer())
    } else {
      throw Object.assign(new Error(`参考图 ${reference.title || index + 1} 不是有效的图片引用`), { status: 400 })
    }
  } else {
    throw Object.assign(new Error(`参考图 ${reference.title || index + 1} 缺少图片引用`), { status: 400 })
  }

  return {
    blob: new Blob([new Uint8Array(buffer)], { type: mime }),
    fileName: safeUploadName(reference, index, mime),
  }
}

function fallbackPublicGeneratedImage(image: ImageHistoryItem): ImageHistoryItem {
  return {
    ...image,
    dataUrl: imageSourceToDataUrl(image.sourceBuffer
      ? { buffer: image.sourceBuffer, mime: image.sourceMime || 'image/png' }
      : null) || image.dataUrl,
    references: [],
    sourceBuffer: undefined,
    sourceMime: undefined,
  }
}

async function generateWithImagesApi(
  prompt: string,
  references: ImageGenReference[],
  size: string,
  quality: ImageQuality,
  count: ImageGenerationCount,
  imageModel: string,
): Promise<ImageProviderResponse> {
  const { IMAGE_GEN_BASE_URL, IMAGE_GEN_API_KEY } = await import('../config.js')
  const { imageRequestFields } = await import('../services/image-api.js')

  const fields = imageRequestFields(prompt, size, quality, count, imageModel)

  if (!references.length) {
    console.log(`[image] forwarding to /images/generations refs=0, model=${imageModel}, size=${size}, count=${count}`)
    const response = await fetch(apiUrl(IMAGE_GEN_BASE_URL, '/images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${IMAGE_GEN_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
    })
    return {
      ...(await parseImagesApiResponse(response, 'Images API 错误')),
      provider: providerName(),
      imageModel,
    }
  }

  console.log(`[image] forwarding to /images/edits refs=${references.length}, model=${imageModel}, size=${size}, count=${count}`)
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, String(value))
  }

  const uploads = await Promise.all(references.map((reference, index) => referenceToBlob(reference, index)))
  for (const upload of uploads) {
    form.append('image[]', upload.blob, upload.fileName)
  }

  const response = await fetch(apiUrl(IMAGE_GEN_BASE_URL, '/images/edits'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${IMAGE_GEN_API_KEY}`,
    },
    body: form,
    signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
  })
  return {
    ...(await parseImagesApiResponse(response, 'Images API 错误')),
    provider: providerName(),
    imageModel,
  }
}

router.post('/image/references', raw({ type: 'image/*', limit: REFERENCE_UPLOAD_LIMIT }), async (req: Request, res: Response) => {
  try {
    const mime = requestContentType(req)
    if (!isAllowedReferenceMime(mime)) {
      res.status(415).json({ error: 'reference image type is not supported' })
      return
    }

    const body = req.body
    const buffer = Buffer.isBuffer(body)
      ? body
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : Buffer.alloc(0)
    if (!buffer.byteLength) {
      res.status(400).json({ error: 'reference image is required' })
      return
    }
    if (buffer.byteLength > REFERENCE_UPLOAD_MAX_BYTES) {
      res.status(413).json({ error: 'reference image is too large' })
      return
    }

    const userId = await getRequestUserId(req)
    const referenceId = headerText(req.get('x-reference-id'), 80) || `ref_${randomUUID()}`
    const title = headerText(req.get('x-reference-title'), 80) || '参考图'
    const fileName = headerText(req.get('x-reference-filename'), 120) || `${referenceId}.${extensionForMime(mime)}`
    const pathHint = [
      'references',
      'uploads',
      userId || 'anon',
      `${Date.now()}_${randomUUID()}_${safePathPart(fileName || referenceId, 'reference')}`,
    ].join('/')
    const stored = await storeImageBuffer(buffer, mime, pathHint)

    if (!stored?.storagePath) {
      res.status(503).json({ error: 'reference image storage is unavailable' })
      return
    }

    res.json({
      reference: {
        id: referenceId,
        title,
        storagePath: stored.storagePath,
        previewUrl: stored.previewUrl || stored.publicUrl,
        previewPath: stored.previewPath,
        thumbnailUrl: stored.thumbnailUrl,
        thumbnailPath: stored.thumbnailPath,
        fileName,
      },
    })
  } catch (err: any) {
    console.error('[image] reference upload failed:', safeErrorDetail(err))
    res.status(err?.status || 500).json({
      error: publicImageErrorMessage(err, '参考图上传失败，请稍后重试。'),
    })
  }
})

router.get('/image/storage/:encodedPath', async (req: Request, res: Response) => {
  try {
    const storagePath = safeProxyStoragePath(req.params.encodedPath)
    if (!storagePath) {
      res.status(400).json({ error: 'invalid image storage path' })
      return
    }
    if (!reserveImageProxyRequest(req)) {
      res.status(429).json({ error: '图片访问过于频繁，请稍后重试。' })
      return
    }
    const reservedBytes = estimateImageProxyBytes(storagePath)
    if (!reserveImageProxyBytes(req, reservedBytes)) {
      res.status(429).json({ error: '图片访问过于频繁，请稍后重试。' })
      return
    }

    let image: ImageSource | null
    try {
      image = await downloadImageBuffer(storagePath)
    } catch (err) {
      releaseImageProxyBytes(req, reservedBytes)
      throw err
    }

    if (!image?.buffer.byteLength) {
      releaseImageProxyBytes(req, reservedBytes)
      res.status(404).json({ error: 'image not found' })
      return
    }

    if (!settleImageProxyBytes(req, reservedBytes, image.buffer.byteLength)) {
      res.status(429).json({ error: '图片访问过于频繁，请稍后重试。' })
      return
    }

    res.setHeader('Content-Type', image.mime || 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
    res.send(image.buffer)
  } catch (err: any) {
    console.error('[image-storage] proxy failed:', safeErrorDetail(err))
    res.status(err?.status || 500).json({
      error: publicImageErrorMessage(err, '图片加载失败，请稍后重试。'),
    })
  }
})

router.post('/image/generate', async (req: Request, res: Response) => {
  const {
    prompt,
    displayPrompt,
    userPrompt,
    systemPrompt,
    modelPrompt,
    size: requestedSize,
    aspectRatio: rawAspectRatio,
    resolution: rawResolution,
    quality: rawQuality,
    count: rawCount,
    references: rawReferences,
    canvasContext,
  } = req.body as ImageGenRequest
  const aspectRatio = normalizeOption(rawAspectRatio, aspectRatios, 'auto')
  const resolution = normalizeOption(rawResolution, resolutions, 'auto')
  const quality = normalizeOption(rawQuality, qualities, 'auto')
  const count = normalizeImageGenerationCount(rawCount)
  const size = requestedSize || sizeByResolution[resolution][aspectRatio]
  const references = Array.isArray(rawReferences)
    ? rawReferences.filter(item => (
      typeof item?.storagePath === 'string' && item.storagePath.trim()
    ) || (
      typeof item?.dataUrl === 'string' && item.dataUrl.trim()
    ))
    : []
  const requestStartedAt = Date.now()
  const generationIp = requestIp(req)
  const generationUserAgent = requestUserAgent(req)
  const appSettings = await getAppSettings()
  const imageModel = appSettings.imageResponsesImageModel
  const sizeError = imageModel === 'gpt-image-2' ? validateGptImage2Size(size) : null
  const creditCostPerImage = appSettings.imageCreditCostPerImage
  const requestedCreditCost = imageCreditCost(count, creditCostPerImage)
  let userId: string | null = null
  let creditReservation: CreditReservation | null = null
  let refundedCredits = 0
  let creditBalance: number | null = null
  let responseMeta: Pick<ImageProviderResponse, 'provider' | 'imageModel' | 'textModel'> = {
    provider: providerName(),
    imageModel,
  }

  async function refundReservedCredits(amount?: number, reason = 'image_generation_failed') {
    if (!userId || !creditReservation) return
    const remaining = creditReservation.amount - refundedCredits
    const refundAmount = Math.min(remaining, amount ?? remaining)
    if (refundAmount <= 0) return

    try {
      const refund = await refundUserCredits(userId, refundAmount, creditReservation.transactionId, {
        reason,
        count,
        size,
        aspectRatio,
        resolution,
        quality,
        creditCostPerImage,
      })
      refundedCredits += refundAmount
      creditBalance = refund.balance
    } catch (refundErr) {
      console.error('[credits] refund failed:', safeErrorDetail(refundErr))
    }
  }

  console.log(`[image] request received refs=${references.length}, size=${size}, quality=${quality}, count=${count}, prompt="${shortPrompt(prompt || '')}"`)

  if (!prompt?.trim()) {
    res.status(400).json({ error: 'prompt is required' })
    return
  }

  const { IMAGE_GEN_API_KEY } = await import('../config.js')
  if (!IMAGE_GEN_API_KEY) {
    res.status(400).json({ error: '图片生成服务尚未配置，请稍后重试。' })
    return
  }

  if (references.length > 16) {
    res.status(400).json({ error: 'reference images are limited to 16 per generation' })
    return
  }

  if (sizeError) {
    res.status(400).json({ error: sizeError })
    return
  }

  try {
    const trimmedPrompt = prompt.trim()
    const historyUserPrompt = requestText(userPrompt) || requestText(displayPrompt) || stripSystemPromptBlocks(trimmedPrompt)
    const historySystemPrompt = requestText(systemPrompt)
    const historyModelPrompt = requestText(modelPrompt) || trimmedPrompt
    userId = await getRequestUserId(req)
    if (!userId && !appSettings.guestGenerationEnabled) {
      res.status(401).json({ error: '请先登录后再生成图片' })
      return
    }
    if (count > 1 && !userId) {
      res.status(401).json({ error: '请先登录后再批量生成图片' })
      return
    }
    if (userId) {
      try {
        creditReservation = await reserveUserCredits(userId, requestedCreditCost, {
          count,
          size,
          aspectRatio,
          resolution,
          quality,
          creditCostPerImage,
          creditCost: requestedCreditCost,
          referenceCount: references.length,
        })
        creditBalance = creditReservation.balance
      } catch (creditErr) {
        if (!canGeneratePublicAfterCreditError(creditErr)) throw creditErr
        if (!appSettings.freeGenerationEnabled) {
          const err: any = new Error('free_generation_disabled')
          err.status = 402
          err.publicMessage = '额度不足且免费生成已关闭，请稍后再试或充值。'
          throw err
        }
        console.warn(`[credits] credit error; generation will be public:`, safeErrorDetail(creditErr))
      }
    }
    let usesCredits = Boolean(creditReservation)
    let response: ImageProviderResponse | null = null
    let lastError: any = null

    for (let attempt = 1; attempt <= IMAGE_RETRY_TIMES; attempt += 1) {
      try {
        console.log(`[image] attempt ${attempt}/${IMAGE_RETRY_TIMES}`)
        response = await generateWithImagesApi(trimmedPrompt, references, size, quality, count, imageModel)
        responseMeta = {
          provider: response.provider,
          imageModel: response.imageModel,
          textModel: response.textModel,
        }
        break
      } catch (err: any) {
        lastError = err
        if (attempt < IMAGE_RETRY_TIMES && isRetryableStatus(err?.status)) {
          const delayMs = Math.min(2 ** (attempt - 1), 8) * 1000
          console.warn(`[image] retryable error status=${err.status}, retrying in ${delayMs}ms (${attempt}/${IMAGE_RETRY_TIMES}): ${safeErrorDetail(err)}`)
          await sleep(delayMs)
          continue
        }
        throw err
      }
    }

    if (!response) throw lastError || new Error('image generation failed')
    const latencyMs = Date.now() - requestStartedAt
    const generationBatchId = `batch_${Date.now()}_${randomUUID()}`

    const images: ImageHistoryItem[] = []
    const pushGeneratedImage = (source: ImageSource, revisedPrompt?: string | null) => {
      const timestamp = new Date().toISOString()
      images.push({
        id: `img_${Date.now()}_${images.length}_${randomUUID()}`,
        generationBatchId,
        dataUrl: undefined,
        sourceBuffer: source.buffer,
        sourceMime: source.mime,
        prompt: historyUserPrompt,
        userPrompt: historyUserPrompt,
        systemPrompt: historySystemPrompt,
        modelPrompt: historyModelPrompt,
        revisedPrompt: revisedPrompt ?? undefined,
        requestIp: generationIp,
        requestUserAgent: generationUserAgent,
        provider: response!.provider,
        imageModel: response!.imageModel,
        textModel: response!.textModel,
        latencyMs,
        size,
        aspectRatio,
        resolution,
        quality,
        timestamp,
      })
    }

    const generatedData: Array<{
      b64_json?: string | null
      url?: string | null
      revised_prompt?: string | null
    }> = 'data' in response && Array.isArray(response.data)
      ? response.data
      : collectImageGenerationResults(response).map(b64_json => ({ b64_json }))

    for (const item of generatedData) {
      const b64 = item.b64_json
      if (b64?.trim()) {
        const source = b64JsonToImageSource(b64)
        if (source) pushGeneratedImage(source, item.revised_prompt)
      } else if (item.url?.trim()) {
        const source = await normalizeGeneratedImageSource(item.url)
        if (source) pushGeneratedImage(source, item.revised_prompt)
      }
    }

    const maxReturnedImages = count
    if (images.length > maxReturnedImages) {
      console.warn(`[image] provider returned ${images.length} image(s); keeping ${maxReturnedImages}`)
      images.length = maxReturnedImages
    }

    console.log(`[image] generated ${images.length} image(s), refs=${references.length}, size=${size}, quality=${quality}, prompt: "${trimmedPrompt.slice(0, 60)}${trimmedPrompt.length > 60 ? '...' : ''}"`)

    const historyReferences = referencesForHistory(references)
    let imagesWithReferences: ImageHistoryItem[] = images.map(image => ({
      ...image,
      userId,
      references: historyReferences,
      visibility: usesCredits ? 'private' : 'public',
      fundingSource: usesCredits ? 'credit' : 'free',
      creditCost: usesCredits ? creditCostPerImage : 0,
      creditTransactionId: creditReservation?.transactionId || null,
    }))

    let responseImages = imagesWithReferences

    try {
      const savedImages = await saveImageHistory(imagesWithReferences, {
        userId,
        allowCreditMetadata: usesCredits,
        allowCreditStorage: usesCredits,
      })
      if (savedImages) {
        responseImages = savedImages
        console.log(`[image-history] saved ${savedImages.length} image(s) to Supabase`)
      } else if (usesCredits) {
        await refundReservedCredits(undefined, 'private_history_save_unavailable')
        throw Object.assign(new Error('private image history save unavailable'), {
          status: 503,
          publicMessage: '私有图片保存失败，已退回额度，请稍后重试。',
        })
      } else {
        responseImages = imagesWithReferences.map(fallbackPublicGeneratedImage)
      }
    } catch (historyErr: any) {
      console.warn('[image-history] save skipped:', safeErrorDetail(historyErr))
      if (usesCredits) {
        await refundReservedCredits(undefined, 'private_history_save_failed')
        throw Object.assign(historyErr instanceof Error ? historyErr : new Error('private image history save failed'), {
          status: historyErr?.status || 503,
          publicMessage: historyErr?.publicMessage || '私有图片保存失败，已退回额度，请稍后重试。',
        })
      }
      responseImages = imagesWithReferences.map(fallbackPublicGeneratedImage)
    }

    if (!responseImages.length) {
      await refundReservedCredits(undefined, 'empty_response')
      await recordImageGenerationAttempt({
        userId,
        provider: response.provider,
        imageModel: response.imageModel,
        textModel: response.textModel,
        status: 'failed',
        latencyMs,
        errorType: 'empty_response',
        errorMessage: 'Provider returned no generated images',
        requestIp: generationIp,
        requestUserAgent: generationUserAgent,
      })
      res.status(502).json({ error: 'image generation returned no images' })
      return
    }

    if (creditReservation && responseImages.length < count) {
      const missingImages = Math.max(0, count - responseImages.length)
      await refundReservedCredits(missingImages * creditCostPerImage, 'partial_generation')
    }

    res.json({
      images: responseImages.map(publicHistoryImage),
      ...(creditBalance !== null ? { creditBalance: { balance: creditBalance } } : {}),
    })

    recordSuccessfulImageGenerationSideEffects({
      images: responseImages,
      userId,
      provider: response.provider,
      imageModel: response.imageModel,
      textModel: response.textModel,
      latencyMs,
      requestIp: generationIp,
      requestUserAgent: generationUserAgent,
      canvasContext,
    })
  } catch (err: any) {
    await refundReservedCredits(undefined, 'image_generation_error')
    console.error('Image generation error:', err.status, safeErrorDetail(err))
    const status = err.status || 500
    const unsupportedReferences = references.length > 0 && [404, 405].includes(status)
    const errorMessage = unsupportedReferences
      ? '当前图片服务暂不支持参考图输入。'
      : publicImageErrorMessage(err, '图片生成失败，请稍后重试。')
    await recordImageGenerationAttempt({
      userId,
      provider: responseMeta.provider,
      imageModel: responseMeta.imageModel,
      textModel: responseMeta.textModel,
      status: 'failed',
      latencyMs: Date.now() - requestStartedAt,
      errorType: errorType(err),
      errorCode: err?.code ? String(err.code) : undefined,
      errorMessage: safeErrorDetail(err, 'image generation failed'),
      httpStatus: status,
      requestIp: generationIp,
      requestUserAgent: generationUserAgent,
    })
    res.status(status).json({ error: errorMessage })
  }
})

export default router
