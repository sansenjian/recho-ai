import { Router, Request, Response, raw } from 'express'
import { randomUUID } from 'node:crypto'
import {
  IMAGE_PROXY_RATE_LIMIT_MAX_BYTES,
  IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS,
  IMAGE_PROXY_RATE_LIMIT_WINDOW_MS,
} from '../config.js'
import { downloadImageBuffer, storeImageBuffer } from '../services/image-storage.js'
import { getRequestUserId } from '../services/request-auth.js'
import { requestIp } from '../services/request-ip.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'
import {
  type ImageSource,
  extensionForMime,
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
      error: publicErrorMessage(err, '参考图上传失败，请稍后重试。'),
    })
  }
})

router.get('/image/storage/*', async (req: Request, res: Response) => {
  try {
    const storagePath = safeProxyStoragePath(req.params[0])
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
      error: publicErrorMessage(err, '图片加载失败，请稍后重试。'),
    })
  }
})

router.post('/image/generate', (_req: Request, res: Response) => {
  res.status(503).json({
    error: '生图服务已迁移到 Go 网关，请启动 Go gateway 或配置 GO_GATEWAY_BASE_URL。',
  })
})

export default router
