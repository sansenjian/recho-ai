import { Router, Request, Response } from 'express'
import { IMAGE_GEN_API_KEY, IMAGE_GEN_BASE_URL, IMAGE_RESPONSES_MODEL } from '../config.js'
import { saveImageHistory, type ImageHistoryItem } from '../services/image-history.js'
import { getRequestUserId } from '../services/request-auth.js'
import { requestIp, requestUserAgent } from '../services/request-ip.js'

const router = Router()

type ImageAspectRatio = 'auto' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16'
type ImageResolution = 'auto' | '1k' | '2k' | '4k'
type ImageQuality = 'auto' | 'low' | 'medium' | 'high'

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
  references?: ImageGenReference[]
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
const IMAGE_RETRY_TIMES = 3
const IMAGE_REQUEST_TIMEOUT_MS = 360_000

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
    ...publicImage
  } = image
  return publicImage
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
  return `${prefix} ${status}: ${compactErrorText(text)}`
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

function imageRequestFields(prompt: string, size: string, quality: ImageQuality) {
  return {
    model: 'gpt-image-2',
    prompt,
    n: 1,
    ...(size === 'auto' ? {} : { size }),
    ...(quality === 'auto' ? {} : { quality }),
  }
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
    console.warn(`[image] generated image url download failed, keeping original url: ${err.message}`)
    return url
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

function responsesInput(prompt: string, references: ImageGenReference[]) {
  if (!references.length) return prompt
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        ...references.map(reference => ({
          type: 'input_image',
          image_url: reference.dataUrl,
        })),
      ],
    },
  ]
}

function responsesImageTool(size: string, quality: ImageQuality) {
  return {
    type: 'image_generation',
    partial_images: 1,
    ...(size === 'auto' ? {} : { size }),
    ...(quality === 'auto' ? {} : { quality }),
  }
}

async function parseResponsesStream(response: globalThis.Response) {
  const text = await response.text()
  const b64Values: string[] = []
  const diagnostics: string[] = []
  const errors: unknown[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (!line.startsWith('data:')) {
      if (diagnostics.length < 8) diagnostics.push(line.slice(0, 500))
      continue
    }

    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue

    try {
      const event = JSON.parse(payload)
      if (event?.error) errors.push(event.error)
      b64Values.push(...collectImageGenerationResults(event))
      if (diagnostics.length < 8) diagnostics.push(JSON.stringify({
        type: event?.type,
        status: event?.status,
        output_index: event?.output_index,
      }))
    } catch {
      if (diagnostics.length < 8) diagnostics.push(payload.slice(0, 500))
    }
  }

  if (!b64Values.length) {
    const detail = diagnostics.slice(-8).join('\n')
    if (errors.length) throw new Error(`Responses API 未返回图片，错误: ${JSON.stringify(errors.at(-1))}，事件摘要:\n${detail}`)
    throw new Error(`Responses API 未返回图片数据，事件摘要:\n${detail}`)
  }

  return { output: b64Values.map(result => ({ type: 'image_generation_call', result })) }
}

async function generateWithResponses(prompt: string, references: ImageGenReference[], size: string, quality: ImageQuality) {
  console.log(`[image] forwarding to /responses refs=${references.length}, model=${IMAGE_RESPONSES_MODEL}, size=${size}`)

  const payload = {
    model: IMAGE_RESPONSES_MODEL,
    input: responsesInput(prompt, references),
    tools: [responsesImageTool(size, quality)],
    stream: true,
  }

  const response = await fetch(apiUrl(IMAGE_GEN_BASE_URL, '/responses'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${IMAGE_GEN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(360_000),
  })

  if (!response.ok) {
    throw Object.assign(
      new Error(providerErrorMessage('Responses API 错误', response.status, await response.text())),
      { status: response.status },
    )
  }

  return parseResponsesStream(response)
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

async function generateWithImagesApi(prompt: string, references: ImageGenReference[], size: string, quality: ImageQuality) {
  const fields = imageRequestFields(prompt, size, quality)

  if (!references.length) {
    console.log(`[image] forwarding to /images/generations refs=0, model=gpt-image-2, size=${size}`)
    const response = await fetch(apiUrl(IMAGE_GEN_BASE_URL, '/images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${IMAGE_GEN_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
    })
    return parseImagesApiResponse(response, 'Images API 错误')
  }

  console.log(`[image] forwarding to /images/edits refs=${references.length}, model=gpt-image-2, size=${size}`)
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
  return parseImagesApiResponse(response, 'Images API 错误')
}

async function generateWithComfyStrategy(prompt: string, references: ImageGenReference[], size: string, quality: ImageQuality) {
  let responsesError: any = null

  try {
    return await generateWithResponses(prompt, references, size, quality)
  } catch (err: any) {
    responsesError = err
    console.warn(`[image] responses failed, falling back to Images API: ${err.message}`)
  }

  try {
    return await generateWithImagesApi(prompt, references, size, quality)
  } catch (err: any) {
    if (responsesError?.message && err?.message) {
      err.message = `${responsesError.message}; ${err.message}`
    }
    throw err
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
    references: rawReferences,
  } = req.body as ImageGenRequest
  const aspectRatio = normalizeOption(rawAspectRatio, aspectRatios, 'auto')
  const resolution = normalizeOption(rawResolution, resolutions, 'auto')
  const quality = normalizeOption(rawQuality, qualities, 'auto')
  const size = requestedSize || sizeByResolution[resolution][aspectRatio]
  const references = Array.isArray(rawReferences)
    ? rawReferences.filter(item => typeof item?.dataUrl === 'string' && item.dataUrl.trim())
    : []
  const sizeError = validateGptImage2Size(size)

  console.log(`[image] request received refs=${references.length}, size=${size}, quality=${quality}, base=${IMAGE_GEN_BASE_URL}, prompt="${shortPrompt(prompt || '')}"`)

  if (!prompt?.trim()) {
    res.status(400).json({ error: 'prompt is required' })
    return
  }

  if (!IMAGE_GEN_API_KEY) {
    res.status(400).json({ error: 'IMAGE_GEN_API_KEY is not configured' })
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
    const userId = await getRequestUserId(req)
    const generationIp = requestIp(req)
    const generationUserAgent = requestUserAgent(req)
    let response: Awaited<ReturnType<typeof generateWithComfyStrategy>> | null = null
    let lastError: any = null

    for (let attempt = 1; attempt <= IMAGE_RETRY_TIMES; attempt += 1) {
      try {
        console.log(`[image] attempt ${attempt}/${IMAGE_RETRY_TIMES}`)
        response = await generateWithComfyStrategy(trimmedPrompt, references, size, quality)
        break
      } catch (err: any) {
        lastError = err
        if (attempt < IMAGE_RETRY_TIMES && isRetryableStatus(err?.status)) {
          const delayMs = Math.min(2 ** (attempt - 1), 8) * 1000
          console.warn(`[image] retryable error status=${err.status}, retrying in ${delayMs}ms (${attempt}/${IMAGE_RETRY_TIMES}): ${err.message}`)
          await sleep(delayMs)
          continue
        }
        throw err
      }
    }

    if (!response) throw lastError || new Error('image generation failed')

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
          size,
          aspectRatio,
          resolution,
          quality,
          timestamp: new Date().toISOString(),
        })
      }
    }

    console.log(`[image] generated ${images.length} image(s), refs=${references.length}, size=${size}, quality=${quality}, prompt: "${trimmedPrompt.slice(0, 60)}${trimmedPrompt.length > 60 ? '...' : ''}"`)

    const historyReferences = referencesForHistory(references)
    const imagesWithReferences: ImageHistoryItem[] = images.map(image => ({
      ...image,
      userId,
      references: historyReferences,
    }))

    let responseImages = imagesWithReferences
    try {
      const savedImages = await saveImageHistory(imagesWithReferences, { userId })
      if (savedImages) {
        responseImages = savedImages
        console.log(`[image-history] saved ${savedImages.length} image(s) to Supabase`)
      }
    } catch (historyErr: any) {
      console.warn(`[image-history] save skipped: ${historyErr.message}`)
    }

    res.json({ images: responseImages.map(publicHistoryImage) })
  } catch (err: any) {
    console.error('Image generation error:', err.status, err.message)
    const status = err.status || 500
    const unsupportedReferences = references.length > 0 && [404, 405].includes(status)
    res.status(status).json({
      error: unsupportedReferences
        ? 'current image provider does not support reference image input'
        : err.message || 'image generation failed',
    })
  }
})

export default router
