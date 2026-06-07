import { Router, Request, Response } from 'express'
import { IMAGE_GEN_API_KEY, IMAGE_GEN_BASE_URL } from '../config.js'
import { recordImageGenerationContext, type ImageCanvasContext } from '../services/image-analytics.js'
import { recordImageGenerationAttempt } from '../services/image-attempts.js'
import { saveImageHistory, type ImageHistoryItem } from '../services/image-history.js'
import { getRequestUserId } from '../services/request-auth.js'
import { requestIp, requestUserAgent } from '../services/request-ip.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'
import {
  CreditOperationError,
  CreditServiceUnavailableError,
  refundUserCredits,
  reserveUserCredits,
  type CreditReservation,
} from '../services/credits.js'

const router = Router()

type ImageAspectRatio = 'auto' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16'
type ImageResolution = 'auto' | '1k' | '2k' | '4k'
type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
type ImageGenerationCount = 1 | 2 | 4 | 8

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

interface ImageGenReference {
  id?: string
  title?: string
  dataUrl: string
  content?: string
  fileName?: string
}

const aspectRatios = new Set<ImageAspectRatio>(['auto', '1:1', '3:2', '2:3', '16:9', '9:16'])
const resolutions = new Set<ImageResolution>(['auto', '1k', '2k', '4k'])
const qualities = new Set<ImageQuality>(['auto', 'low', 'medium', 'high'])
const imageGenerationCounts = new Set<ImageGenerationCount>([1, 2, 4, 8])
const IMAGE_RETRY_TIMES = 3
const IMAGE_REQUEST_TIMEOUT_MS = 360_000
const IMAGE_MODEL = 'gpt-image-2'

interface ImageProviderResponse {
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

const sizeByResolution: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
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
    dataUrl,
    ...publicImage
  } = image
  const hasViewingUrl = Boolean(publicImage.previewUrl || publicImage.thumbnailUrl)
  return {
    ...publicImage,
    ...(!hasViewingUrl && dataUrl ? { dataUrl } : {}),
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableStatus(status?: number) {
  return status === 408 || status === 429 || (typeof status === 'number' && status >= 500)
}

function compactErrorText(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

function providerErrorMessage(prefix: string, status: number, text: string) {
  if (status === 524) {
    return `${prefix} 524: 当前生图服务源站处理超时，Cloudflare 已放弃等待。请求已到达外部服务，但上游没有及时返回。`
  }
  return `${prefix} ${status}: ${safeErrorDetail(compactErrorText(text), 'provider error')}`
}

function apiUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return base.endsWith('/v1') ? `${base}${cleanPath}` : `${base}/v1${cleanPath}`
}

function validateGptImage2Size(size: string) {
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

function imageRequestFields(prompt: string, size: string, quality: ImageQuality, count: ImageGenerationCount) {
  return {
    model: IMAGE_MODEL,
    prompt,
    n: count,
    ...(size === 'auto' ? {} : { size }),
    ...(quality === 'auto' ? {} : { quality }),
  }
}

function providerName() {
  try {
    const host = new URL(IMAGE_GEN_BASE_URL).hostname
    return host.replace(/^api\./, '')
  } catch {
    return IMAGE_GEN_BASE_URL || 'unknown'
  }
}

function errorType(err: any) {
  if (err instanceof CreditOperationError || err instanceof CreditServiceUnavailableError) return 'credits'
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

function imageCreditCost(count: ImageGenerationCount) {
  return Math.max(1, Number(count) || 1)
}

function publicImageErrorMessage(err: any, fallback = '图片生成失败，请稍后重试。') {
  if (typeof err?.publicMessage === 'string' && err.publicMessage) return err.publicMessage
  return publicErrorMessage(err, fallback)
}

function extensionForMime(mime: string) {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

function safeUploadName(reference: ImageGenReference, index: number, mime: string) {
  const rawName = reference.fileName || reference.title || `image_${index + 1}`
  const stem = rawName.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)
  return `${stem || `image_${index + 1}`}.${extensionForMime(mime)}`
}

function referencesForHistory(references: ImageGenReference[]) {
  return references.map((reference, index) => ({
    id: reference.id ? String(reference.id) : `reference_${index + 1}`,
    title: reference.title ? String(reference.title) : `参考图${index + 1}`,
    dataUrl: String(reference.dataUrl),
    content: reference.content ? String(reference.content) : undefined,
    fileName: reference.fileName ? String(reference.fileName) : undefined,
  }))
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl)
  if (!match) return null
  const mime = match[1] || 'image/png'
  const payload = match[3] || ''
  const buffer = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))
  return { mime, buffer }
}

async function referenceToBlob(reference: ImageGenReference, index: number) {
  let mime = 'image/png'
  let buffer: Buffer

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
    throw Object.assign(new Error(`参考图 ${reference.title || index + 1} 不是有效的 data URL 或图片 URL`), { status: 400 })
  }

  return {
    blob: new Blob([new Uint8Array(buffer)], { type: mime }),
    fileName: safeUploadName(reference, index, mime),
  }
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) {
    throw new Error(`生成图片下载失败 ${response.status}: ${compactErrorText(await response.text())}`)
  }
  const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  const buffer = Buffer.from(await response.arrayBuffer())
  return `data:${mime};base64,${buffer.toString('base64')}`
}

async function normalizeGeneratedUrl(url: string) {
  if (url.startsWith('data:image/')) return url
  if (!/^https?:\/\//i.test(url)) return url

  try {
    return await imageUrlToDataUrl(url)
  } catch (err: any) {
    console.warn('[image] generated image url download failed:', safeErrorDetail(err))
    throw Object.assign(new Error('generated image download failed'), { status: err?.status || 502 })
  }
}

function collectImageGenerationResults(value: unknown, results: string[] = []) {
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

async function parseImagesApiResponse(response: globalThis.Response, prefix: string) {
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

async function generateWithImagesApi(prompt: string, references: ImageGenReference[], size: string, quality: ImageQuality, count: ImageGenerationCount): Promise<ImageProviderResponse> {
  const fields = imageRequestFields(prompt, size, quality, count)

  if (!references.length) {
    console.log(`[image] forwarding to /images/generations refs=0, model=${IMAGE_MODEL}, size=${size}, count=${count}`)
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
      ...await parseImagesApiResponse(response, 'Images API 错误'),
      provider: providerName(),
      imageModel: IMAGE_MODEL,
    }
  }

  console.log(`[image] forwarding to /images/edits refs=${references.length}, model=${IMAGE_MODEL}, size=${size}, count=${count}`)
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
    ...await parseImagesApiResponse(response, 'Images API 错误'),
    provider: providerName(),
    imageModel: IMAGE_MODEL,
  }
}

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
    ? rawReferences.filter(item => typeof item?.dataUrl === 'string' && item.dataUrl.trim())
    : []
  const sizeError = validateGptImage2Size(size)
  const requestStartedAt = Date.now()
  const generationIp = requestIp(req)
  const generationUserAgent = requestUserAgent(req)
  let userId: string | null = null
  let creditReservation: CreditReservation | null = null
  let refundedCredits = 0
  let creditBalance: number | null = null
  let responseMeta: Pick<ImageProviderResponse, 'provider' | 'imageModel' | 'textModel'> = {
    provider: providerName(),
    imageModel: IMAGE_MODEL,
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
    if (count > 1 && !userId) {
      res.status(401).json({ error: '请先登录后再批量生成图片' })
      return
    }
    if (userId) {
      try {
        creditReservation = await reserveUserCredits(userId, imageCreditCost(count), {
          count,
          size,
          aspectRatio,
          resolution,
          quality,
          referenceCount: references.length,
        })
        creditBalance = creditReservation.balance
      } catch (creditErr) {
        console.warn('[credits] reservation skipped; generation will be public:', safeErrorDetail(creditErr))
      }
    }
    let usesCredits = Boolean(creditReservation)
    let response: ImageProviderResponse | null = null
    let lastError: any = null

    for (let attempt = 1; attempt <= IMAGE_RETRY_TIMES; attempt += 1) {
      try {
        console.log(`[image] attempt ${attempt}/${IMAGE_RETRY_TIMES}`)
        response = await generateWithImagesApi(trimmedPrompt, references, size, quality, count)
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

    const images: ImageHistoryItem[] = []

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
        const cleanB64 = b64.trim()
        const dataUrl = cleanB64.startsWith('data:image/')
          ? cleanB64
          : `data:image/png;base64,${cleanB64}`
        images.push({
          id: `img_${Date.now()}_${images.length}`,
          dataUrl,
          prompt: historyUserPrompt,
          userPrompt: historyUserPrompt,
          systemPrompt: historySystemPrompt,
          modelPrompt: historyModelPrompt,
          revisedPrompt: item.revised_prompt ?? undefined,
          requestIp: generationIp,
          requestUserAgent: generationUserAgent,
          provider: response.provider,
          imageModel: response.imageModel,
          textModel: response.textModel,
          latencyMs,
          size,
          aspectRatio,
          resolution,
          quality,
          timestamp: new Date().toISOString(),
        })
      } else if (item.url?.trim()) {
        const dataUrl = await normalizeGeneratedUrl(item.url.trim())
        images.push({
          id: `img_${Date.now()}_${images.length}`,
          dataUrl,
          prompt: historyUserPrompt,
          userPrompt: historyUserPrompt,
          systemPrompt: historySystemPrompt,
          modelPrompt: historyModelPrompt,
          revisedPrompt: item.revised_prompt ?? undefined,
          requestIp: generationIp,
          requestUserAgent: generationUserAgent,
          provider: response.provider,
          imageModel: response.imageModel,
          textModel: response.textModel,
          latencyMs,
          size,
          aspectRatio,
          resolution,
          quality,
          timestamp: new Date().toISOString(),
        })
      }
    }

    const maxReturnedImages = creditReservation?.amount ?? count
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
      creditCost: usesCredits ? 1 : 0,
      creditTransactionId: creditReservation?.transactionId || null,
    }))

    let responseImages = imagesWithReferences

    try {
      const savedImages = await saveImageHistory(imagesWithReferences, { userId })
      if (savedImages) {
        responseImages = savedImages
        console.log(`[image-history] saved ${savedImages.length} image(s) to Supabase`)
      } else if (usesCredits) {
        await refundReservedCredits(undefined, 'private_history_save_unavailable')
        throw Object.assign(new Error('private image history save unavailable'), {
          status: 503,
          publicMessage: '私有图片保存失败，已退回额度，请稍后重试。',
        })
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

    if (creditReservation && responseImages.length < creditReservation.amount) {
      await refundReservedCredits(creditReservation.amount - responseImages.length, 'partial_generation')
    }

    const attemptRecords = await Promise.allSettled(responseImages.map(image => recordImageGenerationAttempt({
      generationId: image.id,
      userId,
      provider: response.provider,
      imageModel: response.imageModel,
      textModel: response.textModel,
      status: 'succeeded',
      latencyMs,
      requestIp: generationIp,
      requestUserAgent: generationUserAgent,
    })))
    for (const result of attemptRecords) {
      if (result.status === 'rejected') {
        console.warn('[image-attempts] record skipped:', safeErrorDetail(result.reason))
      }
    }

    const contextRecords = await Promise.allSettled(
      responseImages.map(image => recordImageGenerationContext(image.id, userId, canvasContext)),
    )
    for (const result of contextRecords) {
      if (result.status === 'rejected') {
        console.warn('[image-contexts] record skipped:', safeErrorDetail(result.reason))
      }
    }

    res.json({
      images: responseImages.map(publicHistoryImage),
      ...(creditBalance !== null ? { creditBalance: { balance: creditBalance } } : {}),
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
