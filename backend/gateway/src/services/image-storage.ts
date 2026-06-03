import { SUPABASE_IMAGE_BUCKET } from '../config.js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import sharp from 'sharp'

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i
const IMAGE_FILE_SIZE_LIMIT = '32MB'
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export interface StoredImage {
  publicUrl: string
  storagePath: string
  thumbnailUrl?: string
  thumbnailPath?: string
  mime: string
}

function extensionForMime(mime: string) {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'png'
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

export function imageThumbnailPath(storagePath?: string | null) {
  if (!storagePath) return undefined
  return storagePath.replace(/\.[a-z0-9]+$/i, '.thumb.webp')
}

export async function storeImageDataUrl(dataUrl: string, pathHint: string): Promise<StoredImage | null> {
  if (isStorageUrl(dataUrl)) return null

  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null

  const client = await ensureImageBucket()
  if (!client) return null

  const extension = extensionForMime(parsed.mime)
  const storagePath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.${extension}`
  const { error } = await client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .upload(storagePath, parsed.buffer, {
      contentType: parsed.mime,
      upsert: true,
    })

  if (error) throw error

  const { data } = client.storage
    .from(SUPABASE_IMAGE_BUCKET)
    .getPublicUrl(storagePath)

  let thumbnailUrl: string | undefined
  let thumbnailPath: string | undefined

  try {
    const thumbnailBuffer = await sharp(parsed.buffer)
      .rotate()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer()
    thumbnailPath = `${safePathPart(pathHint).replace(/\.[a-z0-9]+$/i, '')}.thumb.webp`
    const { error: thumbnailError } = await client.storage
      .from(SUPABASE_IMAGE_BUCKET)
      .upload(thumbnailPath, thumbnailBuffer, {
        contentType: 'image/webp',
        upsert: true,
      })
    if (thumbnailError) throw thumbnailError
    thumbnailUrl = client.storage
      .from(SUPABASE_IMAGE_BUCKET)
      .getPublicUrl(thumbnailPath).data.publicUrl
  } catch (err) {
    console.warn('[image-storage] thumbnail generation skipped:', err instanceof Error ? err.message : err)
  }

  return {
    publicUrl: data.publicUrl,
    storagePath,
    thumbnailUrl,
    thumbnailPath,
    mime: parsed.mime,
  }
}
