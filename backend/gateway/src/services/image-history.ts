import { getSupabaseAdminClient } from '../clients/supabase.js'
import {
  imagePublicUrl,
  storeImageDataUrl,
  storePreviewBuffer,
  storeThumbnailBuffer,
} from './image-storage.js'

const IMAGE_HISTORY_TABLE = 'image_generations'
const MAX_HISTORY_LIMIT = 50
const DEFAULT_HISTORY_LIMIT = 12
const IMAGE_HISTORY_LIST_COLUMNS = [
  'id',
  'user_id',
  'storage_path',
  'preview_url',
  'preview_path',
  'thumbnail_url',
  'thumbnail_path',
  'provider',
  'image_model',
  'text_model',
  'latency_ms',
  'image_width',
  'image_height',
  'original_bytes',
  'preview_bytes',
  'thumbnail_bytes',
  'prompt',
  'user_prompt',
  'revised_prompt',
  'size',
  'aspect_ratio',
  'resolution',
  'quality',
  'reference_images',
  'generated_at',
].join(',')
const IMAGE_HISTORY_BACKFILL_COLUMNS = [
  'id',
  'data_url',
  'storage_path',
  'preview_url',
  'preview_path',
  'thumbnail_url',
  'thumbnail_path',
  'reference_images',
].join(',')

export type ImageHistoryScope = 'public' | 'mine'

interface ImageHistoryAccessOptions {
  scope?: ImageHistoryScope
  userId?: string | null
  includeOriginal?: boolean
}

export interface ImageHistoryReference {
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

export interface ImageHistoryItem {
  id: string
  userId?: string | null
  dataUrl?: string
  storagePath?: string
  previewUrl?: string
  previewPath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  prompt: string
  userPrompt?: string
  systemPrompt?: string
  modelPrompt?: string
  references?: ImageHistoryReference[]
  revisedPrompt?: string
  requestIp?: string | null
  requestUserAgent?: string | null
  provider?: string
  imageModel?: string
  textModel?: string
  latencyMs?: number
  imageWidth?: number
  imageHeight?: number
  originalBytes?: number
  previewBytes?: number
  thumbnailBytes?: number
  size: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  timestamp: string
}

interface ImageHistoryRow {
  id: string
  user_id?: string | null
  data_url?: string
  storage_path?: string | null
  preview_url?: string | null
  preview_path?: string | null
  thumbnail_url?: string | null
  thumbnail_path?: string | null
  prompt: string
  user_prompt?: string | null
  system_prompt?: string | null
  model_prompt?: string | null
  revised_prompt: string | null
  request_ip?: string | null
  request_user_agent?: string | null
  provider?: string | null
  image_model?: string | null
  text_model?: string | null
  latency_ms?: number | null
  image_width?: number | null
  image_height?: number | null
  original_bytes?: number | null
  preview_bytes?: number | null
  thumbnail_bytes?: number | null
  size: string
  aspect_ratio: string | null
  resolution: string | null
  quality: string | null
  reference_images: ImageHistoryReference[] | null
  generated_at: string
}

function plainReference(reference: ImageHistoryReference): ImageHistoryReference | null {
  if (!reference?.dataUrl && !reference?.previewUrl && !reference?.thumbnailUrl) return null

  return {
    id: reference.id ? String(reference.id) : undefined,
    title: reference.title ? String(reference.title) : '参考图',
    dataUrl: reference.dataUrl ? String(reference.dataUrl) : undefined,
    storagePath: reference.storagePath ? String(reference.storagePath) : undefined,
    previewUrl: reference.previewUrl ? String(reference.previewUrl) : undefined,
    previewPath: reference.previewPath ? String(reference.previewPath) : undefined,
    thumbnailUrl: reference.thumbnailUrl ? String(reference.thumbnailUrl) : undefined,
    thumbnailPath: reference.thumbnailPath ? String(reference.thumbnailPath) : undefined,
    content: reference.content ? String(reference.content) : undefined,
    fileName: reference.fileName ? String(reference.fileName) : undefined,
  }
}

function plainReferences(references: ImageHistoryReference[] = []) {
  return references
    .map(reference => plainReference(reference))
    .filter((reference): reference is ImageHistoryReference => Boolean(reference))
}

async function storedReference(reference: ImageHistoryReference, imageId: string, index: number) {
  const plain = plainReference(reference)
  if (!plain?.dataUrl) return plain

  const stored = await storeImageDataUrl(plain.dataUrl, `references/${imageId}/${plain.id || `ref_${index + 1}`}`)
  return stored
    ? {
      ...plain,
      dataUrl: stored.publicUrl,
      storagePath: stored.storagePath,
      previewUrl: stored.previewUrl,
      previewPath: stored.previewPath,
      thumbnailUrl: stored.thumbnailUrl,
      thumbnailPath: stored.thumbnailPath,
    }
    : plain
}

async function storedImage(image: ImageHistoryItem) {
  const id = String(image.id)
  const stored = image.dataUrl
    ? await storeImageDataUrl(String(image.dataUrl), `generated/${id}`)
    : null
  const references = await Promise.all(
    plainReferences(image.references).map((reference, index) => storedReference(reference, id, index)),
  )

  return {
    ...image,
    dataUrl: stored?.publicUrl || image.dataUrl,
    storagePath: stored?.storagePath || image.storagePath,
    previewUrl: stored?.previewUrl || image.previewUrl,
    previewPath: stored?.previewPath || image.previewPath,
    thumbnailUrl: stored?.thumbnailUrl || image.thumbnailUrl,
    thumbnailPath: stored?.thumbnailPath || image.thumbnailPath,
    imageWidth: stored?.width || image.imageWidth,
    imageHeight: stored?.height || image.imageHeight,
    originalBytes: stored?.originalBytes || image.originalBytes,
    previewBytes: stored?.previewBytes || image.previewBytes,
    thumbnailBytes: stored?.thumbnailBytes || image.thumbnailBytes,
    references: references.filter((reference): reference is ImageHistoryReference => Boolean(reference)),
  }
}

interface ImageRowOptions {
  includeThumbnails?: boolean
  includeUserId?: boolean
  includePromptDetails?: boolean
  includeRequestMeta?: boolean
  includeMetrics?: boolean
}

function rowFromImage(image: ImageHistoryItem, options: ImageRowOptions = {}): ImageHistoryRow {
  const userPrompt = String(image.userPrompt || image.prompt || '')
  const row: ImageHistoryRow = {
    id: String(image.id),
    data_url: String(image.dataUrl || ''),
    storage_path: image.storagePath ? String(image.storagePath) : null,
    prompt: userPrompt,
    revised_prompt: image.revisedPrompt ? String(image.revisedPrompt) : null,
    size: String(image.size || 'auto'),
    aspect_ratio: image.aspectRatio ? String(image.aspectRatio) : null,
    resolution: image.resolution ? String(image.resolution) : null,
    quality: image.quality ? String(image.quality) : null,
    reference_images: plainReferences(image.references),
    generated_at: String(image.timestamp || new Date().toISOString()),
  }

  if (options.includeThumbnails !== false) {
    row.preview_url = image.previewUrl ? String(image.previewUrl) : null
    row.preview_path = image.previewPath ? String(image.previewPath) : null
    row.thumbnail_url = image.thumbnailUrl ? String(image.thumbnailUrl) : null
    row.thumbnail_path = image.thumbnailPath ? String(image.thumbnailPath) : null
  }

  if (options.includeUserId !== false && image.userId) {
    row.user_id = String(image.userId)
  }

  if (options.includePromptDetails !== false) {
    row.user_prompt = userPrompt
    row.system_prompt = image.systemPrompt ? String(image.systemPrompt) : null
    row.model_prompt = image.modelPrompt ? String(image.modelPrompt) : null
  }

  if (options.includeRequestMeta !== false) {
    row.request_ip = image.requestIp ? String(image.requestIp) : null
    row.request_user_agent = image.requestUserAgent ? String(image.requestUserAgent) : null
  }

  if (options.includeMetrics !== false) {
    row.provider = image.provider ? String(image.provider) : null
    row.image_model = image.imageModel ? String(image.imageModel) : null
    row.text_model = image.textModel ? String(image.textModel) : null
    row.latency_ms = typeof image.latencyMs === 'number' ? Math.max(0, Math.round(image.latencyMs)) : null
    row.image_width = typeof image.imageWidth === 'number' ? Math.round(image.imageWidth) : null
    row.image_height = typeof image.imageHeight === 'number' ? Math.round(image.imageHeight) : null
    row.original_bytes = typeof image.originalBytes === 'number' ? Math.round(image.originalBytes) : null
    row.preview_bytes = typeof image.previewBytes === 'number' ? Math.round(image.previewBytes) : null
    row.thumbnail_bytes = typeof image.thumbnailBytes === 'number' ? Math.round(image.thumbnailBytes) : null
  }

  return row
}

function missingOptionalColumn(error: { message?: string; code?: string }) {
  const message = error.message || ''
  if (error.code !== 'PGRST204') return null
  if (/(preview|thumbnail)_(url|path)/i.test(message)) return 'thumbnail'
  if (/user_id/i.test(message)) return 'user_id'
  if (/(user_prompt|system_prompt|model_prompt)/i.test(message)) return 'prompt_detail'
  if (/(request_ip|request_user_agent)/i.test(message)) return 'request_meta'
  if (/(provider|image_model|text_model|latency_ms|image_width|image_height|original_bytes|preview_bytes|thumbnail_bytes)/i.test(message)) return 'metrics'
  return null
}

function imageFromRow(row: ImageHistoryRow, options: { includeOriginal?: boolean } = {}): ImageHistoryItem {
  const previewPath = row.preview_path || undefined
  const thumbnailPath = row.thumbnail_path || undefined
  const userPrompt = row.user_prompt || row.prompt || ''
  const originalUrl = row.data_url || imagePublicUrl(row.storage_path) || ''
  return {
    id: row.id,
    userId: row.user_id || null,
    ...(options.includeOriginal && originalUrl ? { dataUrl: originalUrl } : {}),
    storagePath: row.storage_path || undefined,
    previewUrl: row.preview_url || imagePublicUrl(previewPath),
    previewPath,
    thumbnailUrl: row.thumbnail_url || imagePublicUrl(thumbnailPath),
    thumbnailPath,
    prompt: userPrompt,
    userPrompt,
    systemPrompt: row.system_prompt || undefined,
    modelPrompt: row.model_prompt || undefined,
    provider: row.provider || undefined,
    imageModel: row.image_model || undefined,
    textModel: row.text_model || undefined,
    latencyMs: row.latency_ms ?? undefined,
    imageWidth: row.image_width ?? undefined,
    imageHeight: row.image_height ?? undefined,
    originalBytes: row.original_bytes ?? undefined,
    previewBytes: row.preview_bytes ?? undefined,
    thumbnailBytes: row.thumbnail_bytes ?? undefined,
    references: plainReferences(row.reference_images || []),
    revisedPrompt: row.revised_prompt || undefined,
    size: row.size || 'auto',
    aspectRatio: row.aspect_ratio || undefined,
    resolution: row.resolution || undefined,
    quality: row.quality || undefined,
    timestamp: row.generated_at,
  }
}

function isInlineDataUrl(value?: string | null) {
  return Boolean(value && /^data:/i.test(value))
}

function isHttpUrl(value?: string | null) {
  return Boolean(value && /^https?:\/\//i.test(value))
}

async function fetchImageBuffer(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`)
  const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mime,
  }
}

function referenceSummary(reference: ImageHistoryReference): ImageHistoryReference | null {
  const plain = plainReference(reference)
  if (!plain) return null
  const displayUrl = plain.thumbnailUrl || plain.previewUrl || (!isInlineDataUrl(plain.dataUrl) ? plain.dataUrl : undefined)

  return {
    id: plain.id,
    title: plain.title,
    dataUrl: displayUrl,
    storagePath: plain.storagePath,
    previewUrl: plain.previewUrl,
    previewPath: plain.previewPath,
    thumbnailUrl: plain.thumbnailUrl,
    thumbnailPath: plain.thumbnailPath,
    content: plain.content,
    fileName: plain.fileName,
  }
}

function imageSummaryFromRow(row: ImageHistoryRow): ImageHistoryItem {
  const previewPath = row.preview_path || undefined
  const previewUrl = row.preview_url || imagePublicUrl(previewPath)
  const thumbnailPath = row.thumbnail_path || undefined
  const thumbnailUrl = row.thumbnail_url || imagePublicUrl(thumbnailPath)
  const userPrompt = row.user_prompt || row.prompt || ''
  return {
    id: row.id,
    userId: row.user_id || null,
    storagePath: row.storage_path || undefined,
    previewUrl,
    previewPath,
    thumbnailUrl,
    thumbnailPath,
    prompt: userPrompt,
    userPrompt,
    systemPrompt: row.system_prompt || undefined,
    modelPrompt: row.model_prompt || undefined,
    provider: row.provider || undefined,
    imageModel: row.image_model || undefined,
    textModel: row.text_model || undefined,
    latencyMs: row.latency_ms ?? undefined,
    imageWidth: row.image_width ?? undefined,
    imageHeight: row.image_height ?? undefined,
    originalBytes: row.original_bytes ?? undefined,
    previewBytes: row.preview_bytes ?? undefined,
    thumbnailBytes: row.thumbnail_bytes ?? undefined,
    references: plainReferences(row.reference_images || [])
      .map(referenceSummary)
      .filter((reference): reference is ImageHistoryReference => Boolean(reference)),
    revisedPrompt: row.revised_prompt || undefined,
    size: row.size || 'auto',
    aspectRatio: row.aspect_ratio || undefined,
    resolution: row.resolution || undefined,
    quality: row.quality || undefined,
    timestamp: row.generated_at,
  }
}

function referenceNeedsThumbnailBackfill(reference: ImageHistoryReference) {
  return Boolean(
    (isInlineDataUrl(reference.dataUrl) || isHttpUrl(reference.dataUrl) || reference.storagePath) &&
    (
      (!reference.previewUrl && !reference.previewPath) ||
      (!reference.thumbnailUrl && !reference.thumbnailPath)
    ),
  )
}

function rowNeedsThumbnailBackfill(row: ImageHistoryRow) {
  return Boolean(
    (isInlineDataUrl(row.data_url) || isHttpUrl(row.data_url) || row.storage_path) &&
    (
      (!row.preview_url && !row.preview_path) ||
      (!row.thumbnail_url && !row.thumbnail_path)
    ),
  ) || Boolean(row.reference_images?.some(referenceNeedsThumbnailBackfill))
}

function rowMayNeedThumbnailBackfill(row: ImageHistoryRow) {
  return Boolean(
    (!row.preview_url && !row.preview_path) ||
    (!row.thumbnail_url && !row.thumbnail_path) ||
    row.reference_images?.some(referenceNeedsThumbnailBackfill),
  )
}

async function backfillReferenceThumbnail(row: ImageHistoryRow, reference: ImageHistoryReference, index: number) {
  const next = { ...reference }
  const pathHint = `references/${row.id}/${reference.id || `ref_${index + 1}`}`

  if (isInlineDataUrl(reference.dataUrl)) {
    const stored = await storeImageDataUrl(reference.dataUrl!, pathHint)
    if (stored) {
      next.dataUrl = stored.publicUrl
      next.storagePath = stored.storagePath
      next.previewUrl = stored.previewUrl
      next.previewPath = stored.previewPath
      next.thumbnailUrl = stored.thumbnailUrl
      next.thumbnailPath = stored.thumbnailPath
    }
    return next
  }

  if ((!reference.previewUrl && !reference.previewPath) || (!reference.thumbnailUrl && !reference.thumbnailPath)) {
    const sourceUrl = isHttpUrl(reference.dataUrl)
      ? reference.dataUrl
      : imagePublicUrl(reference.storagePath)
    if (sourceUrl) {
      const { buffer } = await fetchImageBuffer(sourceUrl)
      if (!reference.previewUrl && !reference.previewPath) {
        const preview = await storePreviewBuffer(buffer, pathHint)
        if (preview) {
          next.previewUrl = preview.previewUrl
          next.previewPath = preview.previewPath
        }
      }
      if (!reference.thumbnailUrl && !reference.thumbnailPath) {
        const thumbnail = await storeThumbnailBuffer(buffer, pathHint)
        if (thumbnail) {
          next.thumbnailUrl = thumbnail.thumbnailUrl
          next.thumbnailPath = thumbnail.thumbnailPath
        }
      }
    }
  }

  return next
}

async function backfillRowThumbnail(row: ImageHistoryRow) {
  const updates: Partial<ImageHistoryRow> = {}

  if (isInlineDataUrl(row.data_url)) {
    const stored = await storeImageDataUrl(row.data_url!, `generated/${row.id}`)
    if (stored) {
      updates.data_url = stored.publicUrl
      updates.storage_path = stored.storagePath
      updates.preview_url = stored.previewUrl
      updates.preview_path = stored.previewPath
      updates.thumbnail_url = stored.thumbnailUrl
      updates.thumbnail_path = stored.thumbnailPath
    }
  } else if ((!row.preview_url && !row.preview_path) || (!row.thumbnail_url && !row.thumbnail_path)) {
    const sourceUrl = isHttpUrl(row.data_url) ? row.data_url : imagePublicUrl(row.storage_path)
    if (sourceUrl) {
      const { buffer } = await fetchImageBuffer(sourceUrl)
      if (!row.preview_url && !row.preview_path) {
        const preview = await storePreviewBuffer(buffer, `generated/${row.id}`)
        if (preview) {
          updates.preview_url = preview.previewUrl
          updates.preview_path = preview.previewPath
        }
      }
      if (!row.thumbnail_url && !row.thumbnail_path) {
        const thumbnail = await storeThumbnailBuffer(buffer, `generated/${row.id}`)
        if (thumbnail) {
          updates.thumbnail_url = thumbnail.thumbnailUrl
          updates.thumbnail_path = thumbnail.thumbnailPath
        }
      }
    }
  }

  if (row.reference_images?.some(referenceNeedsThumbnailBackfill)) {
    updates.reference_images = await Promise.all(
      row.reference_images.map((reference, index) => backfillReferenceThumbnail(row, reference, index)),
    )
  }

  return updates
}

async function backfillMissingThumbnails(rows: ImageHistoryRow[]) {
  const client = historyClient()
  if (!client) return

  const candidateIds = rows
    .filter(rowMayNeedThumbnailBackfill)
    .map(row => row.id)
    .filter(Boolean)
  if (!candidateIds.length) return

  try {
    const { data, error } = await client
      .from(IMAGE_HISTORY_TABLE)
      .select(IMAGE_HISTORY_BACKFILL_COLUMNS)
      .in('id', candidateIds)

    if (error) throw error

    for (const row of (data || []) as unknown as ImageHistoryRow[]) {
      if (!rowNeedsThumbnailBackfill(row)) continue

      try {
        const updates = await backfillRowThumbnail(row)
        if (!Object.keys(updates).length) continue

        const { error } = await client
          .from(IMAGE_HISTORY_TABLE)
          .update(updates)
          .eq('id', row.id)

        if (error) throw error
        console.log(`[image-history] backfilled image renditions for ${row.id}`)
      } catch (err) {
        console.warn('[image-history] rendition backfill skipped:', err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.warn('[image-history] rendition backfill lookup skipped:', err instanceof Error ? err.message : err)
  }
}

function historyClient() {
  return getSupabaseAdminClient()
}

export function hasImageHistoryStore() {
  return Boolean(historyClient())
}

export async function listImageHistory(
  limit = DEFAULT_HISTORY_LIMIT,
  offset = 0,
  options: ImageHistoryAccessOptions = {},
) {
  const client = historyClient()
  const cappedLimit = Math.max(1, Math.min(MAX_HISTORY_LIMIT, limit))
  const safeOffset = Math.max(0, offset)
  if (!client || (options.scope === 'mine' && !options.userId)) {
    return {
      images: [],
      total: 0,
      limit: cappedLimit,
      offset: safeOffset,
      hasMore: false,
      nextOffset: null,
    }
  }

  let query = client
    .from(IMAGE_HISTORY_TABLE)
    .select(IMAGE_HISTORY_LIST_COLUMNS, { count: 'exact' })
    .order('generated_at', { ascending: false })

  if (options.scope === 'mine') {
    query = query.eq('user_id', options.userId!)
  }

  const { data, error, count } = await query
    .range(safeOffset, safeOffset + cappedLimit - 1)

  if (error) throw error
  const rows = (data || []) as unknown as ImageHistoryRow[]
  void backfillMissingThumbnails(rows)
  const images = rows.map(row => imageSummaryFromRow(row))
  const total = count ?? safeOffset + images.length
  const nextOffset = safeOffset + images.length
  return {
    images,
    total,
    limit: cappedLimit,
    offset: safeOffset,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  }
}

export async function getImageHistory(id: string, options: ImageHistoryAccessOptions = {}) {
  const client = historyClient()
  if (!client || (options.scope === 'mine' && !options.userId)) return null

  let query = client
    .from(IMAGE_HISTORY_TABLE)
    .select('*')
    .eq('id', id)

  if (options.scope === 'mine') {
    query = query.eq('user_id', options.userId!)
  }

  const { data, error } = await query
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  let row = data as ImageHistoryRow
  if (rowNeedsThumbnailBackfill(row)) {
    try {
      const updates = await backfillRowThumbnail(row)
      if (Object.keys(updates).length) {
        const { error } = await client
          .from(IMAGE_HISTORY_TABLE)
          .update(updates)
          .eq('id', row.id)

        if (error) throw error
        row = { ...row, ...updates }
      }
    } catch (err) {
      console.warn('[image-history] detail rendition backfill skipped:', err instanceof Error ? err.message : err)
    }
  }

  return imageFromRow(row, { includeOriginal: options.includeOriginal })
}

export async function saveImageHistory(images: ImageHistoryItem[], options: { userId?: string | null } = {}) {
  const client = historyClient()
  if (!client || !images.length) return null

  const storedImages = await Promise.all(
    images
      .filter(image => image?.id && image?.dataUrl)
      .map(image => storedImage({
        ...image,
        ...(options.userId ? { userId: options.userId } : {}),
      })),
  )
  const validImages = storedImages
    .filter(image => image?.id && image?.dataUrl)

  if (!validImages.length) return null

  const rowOptions: Required<ImageRowOptions> = {
    includeThumbnails: true,
    includeUserId: true,
    includePromptDetails: true,
    includeRequestMeta: true,
    includeMetrics: true,
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = validImages.map(image => rowFromImage(image, rowOptions))
    const { error } = await client
      .from(IMAGE_HISTORY_TABLE)
      .upsert(rows, { onConflict: 'id' })

    if (!error) return storedImages

    const missingColumn = missingOptionalColumn(error)
    if (missingColumn === 'thumbnail' && rowOptions.includeThumbnails) {
      rowOptions.includeThumbnails = false
      console.warn('[image-history] thumbnail columns missing; retrying save without thumbnail fields')
      continue
    }
    if (missingColumn === 'user_id' && rowOptions.includeUserId) {
      rowOptions.includeUserId = false
      console.warn('[image-history] user_id column missing; retrying save without user id')
      continue
    }
    if (missingColumn === 'prompt_detail' && rowOptions.includePromptDetails) {
      rowOptions.includePromptDetails = false
      console.warn('[image-history] prompt detail columns missing; retrying save without split prompt fields')
      continue
    }
    if (missingColumn === 'request_meta' && rowOptions.includeRequestMeta) {
      rowOptions.includeRequestMeta = false
      console.warn('[image-history] request metadata columns missing; retrying save without request metadata')
      continue
    }
    if (missingColumn === 'metrics' && rowOptions.includeMetrics) {
      rowOptions.includeMetrics = false
      console.warn('[image-history] metric columns missing; retrying save without generation metrics')
      continue
    }

    throw error
  }

  return storedImages
}

export async function deleteImageHistory(id: string, options: { userId?: string | null } = {}) {
  const client = historyClient()
  if (!client || !options.userId) return false

  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', options.userId)
    .select('id')

  if (error) throw error
  return Boolean(data?.length)
}

export async function clearImageHistory(options: { userId?: string | null } = {}) {
  const client = historyClient()
  if (!client || !options.userId) return false

  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .delete()
    .eq('user_id', options.userId)
    .select('id')

  if (error) throw error
  return Boolean(data?.length)
}
