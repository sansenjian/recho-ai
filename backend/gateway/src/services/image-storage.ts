import { SUPABASE_IMAGE_BUCKET } from '../config.js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import {
  deleteTencentCosObject,
  getTencentCosObject,
  hasTencentCosConfig,
  putTencentCosObject,
  tencentCosObjectUrl,
} from '../clients/tencent-cos.js'
import sharp from 'sharp'

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i
const IMAGE_FILE_SIZE_LIMIT = '32MB'
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const IMAGE_CACHE_CONTROL = '31536000'
const LOSSLESS_WEBP_MIME = 'image/webp'
const LOSSLESS_WEBP_EXTENSION = 'webp'
const PUBLIC_URL_CACHE_MS = 10 * 60 * 1000
const PUBLIC_URL_CACHE_MAX = 10_000
const TENCENT_COS_PATH_PREFIX = 'cos://'
const IMAGE_PROXY_PATH_PREFIX = '/api/image/storage/'

export type ImageStorageProvider = 'supabase' | 'tencent-cos'

export interface StoredImage {
  publicUrl: string
  storagePath: string
  previewUrl?: string
  previewPath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  mime: string
  width?: number
  height?: number
  originalBytes?: number
  previewBytes?: number
  thumbnailBytes?: number
}

export interface StoredPreview {
  previewUrl: string
  previewPath: string
  previewBytes: number
}

export interface StoredThumbnail {
  thumbnailUrl: string
  thumbnailPath: string
  thumbnailBytes: number
}

export interface StoreImageOptions {
  provider?: ImageStorageProvider
}

function extensionForMime(mime: string) {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'png'
}

function normalizedMime(mime: string) {
  return mime.split(';')[0]?.trim().toLowerCase() || 'image/png'
}

async function originalStorageImage(buffer: Buffer, mime: string) {
  const sourceMime = normalizedMime(mime)
  if (sourceMime !== 'image/png') {
    const metadata = await sharp(buffer).metadata().catch(() => null)
    return {
      buffer,
      mime: sourceMime,
      extension: extensionForMime(sourceMime),
      metadata,
    }
  }

  const webpBuffer = await sharp(buffer)
    .rotate()
    .webp({ lossless: true })
    .toBuffer()
  const metadata = await sharp(webpBuffer).metadata().catch(() => null)
  return {
    buffer: webpBuffer,
    mime: LOSSLESS_WEBP_MIME,
    extension: LOSSLESS_WEBP_EXTENSION,
    metadata,
  }
}

function parseDataUrl(dataUrl: string) {
  const match = DATA_URL_RE.exec(dataUrl)
  if (!match) return null

  const mime = match[1] || 'image/png'
  const payload = match[3] || ''
  const buffer = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))

  return { mime, buffer }
}

function safePathPart(value: string) {
  return value
    .replace(/[^a-zA-Z0-9_\-./]+/g, '_')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .slice(0, 160)
}

let bucketReady = false
let bucketReadyPromise: Promise<ReturnType<typeof getSupabaseAdminClient>> | null = null
const publicUrlCache = new Map<string, { publicUrl: string; expiresAt: number }>()

function cosPath(key: string) {
  return `${TENCENT_COS_PATH_PREFIX}${key}`
}

function cosKey(storagePath?: string | null) {
  if (!storagePath?.startsWith(TENCENT_COS_PATH_PREFIX)) return null
  const key = storagePath.slice(TENCENT_COS_PATH_PREFIX.length).replace(/^\/+/, '')
  return key || null
}

function isSafeProxyStoragePath(storagePath: string) {
  if (/^https?:\/\//i.test(storagePath) || /^data:/i.test(storagePath)) return false
  const path = cosKey(storagePath) || storagePath
  return Boolean(path && !path.includes('..') && !path.startsWith('/') && !path.startsWith('\\'))
}

export function proxiedImageStorageUrl(storagePath?: string | null) {
  if (!storagePath || !isSafeProxyStoragePath(storagePath)) return undefined
  return `${IMAGE_PROXY_PATH_PREFIX}${encodeURIComponent(storagePath)}`
}

function storageProvider(options: StoreImageOptions = {}): ImageStorageProvider {
  return options.provider === 'tencent-cos' ? 'tencent-cos' : 'supabase'
}

async function doEnsureImageBucket(): Promise<ReturnType<typeof getSupabaseAdminClient>> {
  const client = getSupabaseAdminClient()
  if (!client) return null
  if (bucketReady) return client

  const { data } = await client.storage.getBucket(SUPABASE_IMAGE_BUCKET)
  if (data) {
    const { error } = await client.storage.updateBucket(SUPABASE_IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: IMAGE_FILE_SIZE_LIMIT,
      allowedMimeTypes: IMAGE_MIME_TYPES,
    })
    if (error) throw error
  } else if (!data) {
    const { error } = await client.storage.createBucket(SUPABASE_IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: IMAGE_FILE_SIZE_LIMIT,
      allowedMimeTypes: IMAGE_MIME_TYPES,
    })
    if (error && !/already exists/i.test(error.message)) throw error
  }

  bucketReady = true
  return client
}

async function ensureImageBucket(): Promise<ReturnType<typeof getSupabaseAdminClient>> {
  if (bucketReady) {
    const client = getSupabaseAdminClient()
    if (client) return client
  }
  if (bucketReadyPromise) return bucketReadyPromise
  bucketReadyPromise = doEnsureImageBucket()
  try {
    return await bucketReadyPromise
  } finally {
    bucketReadyPromise = null
  }
}

export function isStorageUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

export function imagePublicUrl(storagePath?: string | null) {
  if (!storagePath) return undefined
  const key = cosKey(storagePath)
  if (key) return tencentCosObjectUrl(key) || proxiedImageStorageUrl(storagePath)

  const now = Date.now()
  const cached = publicUrlCache.get(storagePath)
  if (cached && cached.expiresAt > now) return cached.publicUrl

  const client = getSupabaseAdminClient()
  if (!client) return proxiedImageStorageUrl(storagePath)

  const publicUrl = client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl
  publicUrlCache.set(storagePath, { publicUrl, expiresAt: now + PUBLIC_URL_CACHE_MS })
  prunePublicUrlCache(now)
  return publicUrl
}

function prunePublicUrlCache(now = Date.now()) {
  if (publicUrlCache.size <= PUBLIC_URL_CACHE_MAX) return

  for (const [path, cached] of publicUrlCache) {
    if (cached.expiresAt <= now) publicUrlCache.delete(path)
    if (publicUrlCache.size <= PUBLIC_URL_CACHE_MAX) return
  }

  for (const path of publicUrlCache.keys()) {
    publicUrlCache.delete(path)
    if (publicUrlCache.size <= PUBLIC_URL_CACHE_MAX) return
  }
}

export function clearImagePublicUrlCache(paths?: string[]) {
  if (!paths) {
    publicUrlCache.clear()
    return
  }
  for (const path of paths) publicUrlCache.delete(path)
}

export async function removeImageStoragePaths(paths: Array<string | null | undefined>) {
  const uniquePaths = Array.from(new Set(paths.filter((path): path is string => Boolean(path))))
  if (!uniquePaths.length) return false
  let removed = false

  const cosPaths = uniquePaths
    .map(path => cosKey(path))
    .filter((path): path is string => Boolean(path))
  if (cosPaths.length) {
    const results = await Promise.all(cosPaths.map(key => deleteTencentCosObject(key)))
    removed = results.some(Boolean)
  }

  const supabasePaths = uniquePaths.filter(path => !cosKey(path))
  if (!supabasePaths.length) {
    clearImagePublicUrlCache(uniquePaths)
    return removed
  }

  const client = getSupabaseAdminClient()
  if (!client) return removed

  const { error } = await client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .remove(supabasePaths)
  if (error) throw error

  removed = true
  clearImagePublicUrlCache(uniquePaths)
  return removed
}

export async function downloadImageBuffer(storagePath: string) {
  const key = cosKey(storagePath)
  if (key) {
    return await getTencentCosObject(key)
  }

  const client = getSupabaseAdminClient()
  if (!client) return null

  const { data, error } = await client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .download(storagePath)
  if (error) throw error
  if (!data) return null

  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    mime: data.type || 'image/png',
  }
}

export function imageThumbnailPath(storagePath?: string | null) {
  if (!storagePath) return undefined
  const key = cosKey(storagePath)
  if (key) return cosPath(key.replace(/\.[a-z0-9]+$/i, '.thumb.webp'))
  return storagePath.replace(/\.[a-z0-9]+$/i, '.thumb.webp')
}

export function imagePreviewPath(storagePath?: string | null) {
  if (!storagePath) return undefined
  const key = cosKey(storagePath)
  if (key) return cosPath(key.replace(/\.[a-z0-9]+$/i, '.preview.webp'))
  return storagePath.replace(/\.[a-z0-9]+$/i, '.preview.webp')
}

async function uploadSupabaseBuffer(buffer: Buffer, mime: string, storagePath: string) {
  const client = await ensureImageBucket()
  if (!client) return null
  const { error } = await client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .upload(storagePath, buffer, {
      cacheControl: IMAGE_CACHE_CONTROL,
      contentType: mime,
      upsert: true,
    })
  if (error) throw error
  const { data } = client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .getPublicUrl(storagePath)
  return {
    publicUrl: data.publicUrl,
    storagePath,
  }
}

async function uploadCosBuffer(buffer: Buffer, mime: string, key: string) {
  const stored = await putTencentCosObject({
    key,
    body: buffer,
    contentType: mime,
    cacheControl: `max-age=${IMAGE_CACHE_CONTROL}`,
  })
  if (!stored) return null

  return {
    ...stored,
    publicUrl: stored.publicUrl ?? proxiedImageStorageUrl(stored.storagePath) ?? '',
  }
}

async function uploadStorageBuffer(
  buffer: Buffer,
  mime: string,
  storagePath: string,
  options: StoreImageOptions = {},
) {
  if (storageProvider(options) === 'tencent-cos') {
    if (!hasTencentCosConfig()) {
      console.warn('[image-storage] Tencent COS config missing; falling back to Supabase for path:', storagePath)
      return await uploadSupabaseBuffer(buffer, mime, storagePath)
    } else {
      const cosStored = await uploadCosBuffer(buffer, mime, storagePath)
      if (cosStored) return cosStored
      console.warn('[image-storage] Tencent COS upload returned null; falling back to Supabase for path:', storagePath)
      return await uploadSupabaseBuffer(buffer, mime, storagePath)
    }
  }
  return await uploadSupabaseBuffer(buffer, mime, storagePath)
}

export async function storePreviewBuffer(
  buffer: Buffer,
  pathHint: string,
  options: StoreImageOptions = {},
): Promise<StoredPreview | null> {
  const previewBuffer = await sharp(buffer)
    .rotate()
    .webp({ quality: 86 })
    .toBuffer()
  const previewPath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.preview.webp`
  const stored = await uploadStorageBuffer(previewBuffer, 'image/webp', previewPath, options)
  if (!stored) return null

  return {
    previewUrl: stored.publicUrl,
    previewPath: stored.storagePath,
    previewBytes: previewBuffer.byteLength,
  }
}

export async function storeThumbnailBuffer(
  buffer: Buffer,
  pathHint: string,
  options: StoreImageOptions = {},
): Promise<StoredThumbnail | null> {
  const thumbnailBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer()
  const thumbnailPath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.thumb.webp`
  const stored = await uploadStorageBuffer(thumbnailBuffer, 'image/webp', thumbnailPath, options)
  if (!stored) return null

  return {
    thumbnailUrl: stored.publicUrl,
    thumbnailPath: stored.storagePath,
    thumbnailBytes: thumbnailBuffer.byteLength,
  }
}

export async function storeImageBuffer(
  buffer: Buffer,
  mime: string,
  pathHint: string,
  options: StoreImageOptions = {},
): Promise<StoredImage | null> {
  const original = await originalStorageImage(buffer, mime)
  const storagePath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.${original.extension}`
  const stored = await uploadStorageBuffer(original.buffer, original.mime, storagePath, options)
  if (!stored) return null

  let preview: StoredPreview | null = null
  try {
    preview = await storePreviewBuffer(original.buffer, pathHint, options)
  } catch (err) {
    console.warn('[image-storage] preview generation skipped:', err instanceof Error ? err.message : err)
  }

  let thumbnail: StoredThumbnail | null = null
  try {
    thumbnail = await storeThumbnailBuffer(original.buffer, pathHint, options)
  } catch (err) {
    console.warn('[image-storage] thumbnail generation skipped:', err instanceof Error ? err.message : err)
  }

  return {
    publicUrl: stored.publicUrl,
    storagePath: stored.storagePath,
    previewUrl: preview?.previewUrl,
    previewPath: preview?.previewPath,
    thumbnailUrl: thumbnail?.thumbnailUrl,
    thumbnailPath: thumbnail?.thumbnailPath,
    mime: original.mime,
    width: original.metadata?.width,
    height: original.metadata?.height,
    originalBytes: original.buffer.byteLength,
    previewBytes: preview?.previewBytes,
    thumbnailBytes: thumbnail?.thumbnailBytes,
  }
}

export async function storeImageDataUrl(
  dataUrl: string,
  pathHint: string,
  options: StoreImageOptions = {},
): Promise<StoredImage | null> {
  if (isStorageUrl(dataUrl)) return null

  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null

  return await storeImageBuffer(parsed.buffer, parsed.mime, pathHint, options)
}
