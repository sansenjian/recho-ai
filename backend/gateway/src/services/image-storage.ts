import { SUPABASE_IMAGE_BUCKET } from '../config.js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import sharp from 'sharp'

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i
const IMAGE_FILE_SIZE_LIMIT = '32MB'
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const IMAGE_CACHE_CONTROL = '31536000'
const LOSSLESS_WEBP_MIME = 'image/webp'
const LOSSLESS_WEBP_EXTENSION = 'webp'

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

async function ensureImageBucket() {
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

export function isStorageUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

export function imagePublicUrl(storagePath?: string | null) {
  if (!storagePath) return undefined
  const client = getSupabaseAdminClient()
  if (!client) return undefined
  return client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl
}

export async function downloadImageBuffer(storagePath: string) {
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
  return storagePath.replace(/\.[a-z0-9]+$/i, '.thumb.webp')
}

export function imagePreviewPath(storagePath?: string | null) {
  if (!storagePath) return undefined
  return storagePath.replace(/\.[a-z0-9]+$/i, '.preview.webp')
}

export async function storePreviewBuffer(buffer: Buffer, pathHint: string): Promise<StoredPreview | null> {
  const client = await ensureImageBucket()
  if (!client) return null

  const previewBuffer = await sharp(buffer)
    .rotate()
    .webp({ quality: 86 })
    .toBuffer()
  const previewPath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.preview.webp`
  const { error: previewError } = await client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .upload(previewPath, previewBuffer, {
      cacheControl: IMAGE_CACHE_CONTROL,
      contentType: 'image/webp',
      upsert: true,
    })
  if (previewError) throw previewError
  const previewUrl = client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .getPublicUrl(previewPath).data.publicUrl

  return { previewUrl, previewPath, previewBytes: previewBuffer.byteLength }
}

export async function storeThumbnailBuffer(buffer: Buffer, pathHint: string): Promise<StoredThumbnail | null> {
  const client = await ensureImageBucket()
  if (!client) return null

  const thumbnailBuffer = await sharp(buffer)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer()
  const thumbnailPath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.thumb.webp`
  const { error: thumbnailError } = await client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .upload(thumbnailPath, thumbnailBuffer, {
      cacheControl: IMAGE_CACHE_CONTROL,
      contentType: 'image/webp',
      upsert: true,
    })
  if (thumbnailError) throw thumbnailError
  const thumbnailUrl = client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .getPublicUrl(thumbnailPath).data.publicUrl

  return { thumbnailUrl, thumbnailPath, thumbnailBytes: thumbnailBuffer.byteLength }
}

export async function storeImageBuffer(buffer: Buffer, mime: string, pathHint: string): Promise<StoredImage | null> {
  const client = await ensureImageBucket()
  if (!client) return null

  const original = await originalStorageImage(buffer, mime)
  const storagePath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.${original.extension}`
  const { error } = await client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .upload(storagePath, original.buffer, {
      cacheControl: IMAGE_CACHE_CONTROL,
      contentType: original.mime,
      upsert: true,
    })

  if (error) throw error

  const { data } = client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .getPublicUrl(storagePath)

  let preview: StoredPreview | null = null
  try {
    preview = await storePreviewBuffer(original.buffer, pathHint)
  } catch (err) {
    console.warn('[image-storage] preview generation skipped:', err instanceof Error ? err.message : err)
  }

  let thumbnail: StoredThumbnail | null = null
  try {
    thumbnail = await storeThumbnailBuffer(original.buffer, pathHint)
  } catch (err) {
    console.warn('[image-storage] thumbnail generation skipped:', err instanceof Error ? err.message : err)
  }

  return {
    publicUrl: data.publicUrl,
    storagePath,
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

export async function storeImageDataUrl(dataUrl: string, pathHint: string): Promise<StoredImage | null> {
  if (isStorageUrl(dataUrl)) return null

  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null

  return await storeImageBuffer(parsed.buffer, parsed.mime, pathHint)
}
