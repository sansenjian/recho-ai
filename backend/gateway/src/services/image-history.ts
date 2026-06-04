import { getSupabaseAdminClient } from '../clients/supabase.js'
import { imagePublicUrl, storeImageDataUrl, storeThumbnailBuffer } from './image-storage.js'

const IMAGE_HISTORY_TABLE = 'image_generations'
const MAX_HISTORY_LIMIT = 50
const DEFAULT_HISTORY_LIMIT = 12
const IMAGE_HISTORY_LIST_COLUMNS = [
  'id',
  'user_id',
  'storage_path',
  'thumbnail_url',
  'thumbnail_path',
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
  'thumbnail_url',
  'thumbnail_path',
  'reference_images',
].join(',')

export interface ImageHistoryReference {
  id?: string
  title?: string
  dataUrl?: string
  storagePath?: string
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
  thumbnail_url?: string | null
  thumbnail_path?: string | null
  prompt: string
  user_prompt?: string | null
  system_prompt?: string | null
  model_prompt?: string | null
  revised_prompt: string | null
  request_ip?: string | null
  request_user_agent?: string | null
  size: string
  aspect_ratio: string | null
  resolution: string | null
  quality: string | null
  reference_images: ImageHistoryReference[] | null
  generated_at: string
}

function plainReference(reference: ImageHistoryReference): ImageHistoryReference | null {
  if (!reference?.dataUrl && !reference?.thumbnailUrl) return null

  return {
    id: reference.id ? String(reference.id) : undefined,
    title: reference.title ? String(reference.title) : '参考图',
    dataUrl: reference.dataUrl ? String(reference.dataUrl) : undefined,
    storagePath: reference.storagePath ? String(reference.storagePath) : undefined,
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
    thumbnailUrl: stored?.thumbnailUrl || image.thumbnailUrl,
    thumbnailPath: stored?.thumbnailPath || image.thumbnailPath,
    references: references.filter((reference): reference is ImageHistoryReference => Boolean(reference)),
  }
}

interface ImageRowOptions {
  includeThumbnails?: boolean
  includeUserId?: boolean
  includePromptDetails?: boolean
  includeRequestMeta?: boolean
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

  return row
}

function missingOptionalColumn(error: { message?: string; code?: string }) {
  const message = error.message || ''
  if (error.code !== 'PGRST204') return null
  if (/thumbnail_(url|path)/i.test(message)) return 'thumbnail'
  if (/user_id/i.test(message)) return 'user_id'
  if (/(user_prompt|system_prompt|model_prompt)/i.test(message)) return 'prompt_detail'
  if (/(request_ip|request_user_agent)/i.test(message)) return 'request_meta'
  return null
}

function imageFromRow(row: ImageHistoryRow): ImageHistoryItem {
  const thumbnailPath = row.thumbnail_path || undefined
  const userPrompt = row.user_prompt || row.prompt || ''
  return {
    id: row.id,
    userId: row.user_id || null,
    dataUrl: row.data_url || '',
    storagePath: row.storage_path || undefined,
    thumbnailUrl: row.thumbnail_url || imagePublicUrl(thumbnailPath),
    thumbnailPath,
    prompt: userPrompt,
    userPrompt,
    systemPrompt: row.system_prompt || undefined,
    modelPrompt: row.model_prompt || undefined,
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
  const displayUrl = plain.thumbnailUrl || (!isInlineDataUrl(plain.dataUrl) ? plain.dataUrl : undefined)

  return {
    id: plain.id,
    title: plain.title,
    dataUrl: displayUrl,
    storagePath: plain.storagePath,
    thumbnailUrl: plain.thumbnailUrl,
    thumbnailPath: plain.thumbnailPath,
    content: plain.content,
    fileName: plain.fileName,
  }
}

function imageSummaryFromRow(row: ImageHistoryRow): ImageHistoryItem {
  const thumbnailPath = row.thumbnail_path || undefined
  const thumbnailUrl = row.thumbnail_url || imagePublicUrl(thumbnailPath)
  const originalUrl = !isInlineDataUrl(row.data_url)
    ? row.data_url
    : imagePublicUrl(row.storage_path)
  const userPrompt = row.user_prompt || row.prompt || ''
  return {
    id: row.id,
    userId: row.user_id || null,
    dataUrl: thumbnailUrl ? undefined : originalUrl,
    storagePath: row.storage_path || undefined,
    thumbnailUrl,
    thumbnailPath,
    prompt: userPrompt,
    userPrompt,
    systemPrompt: row.system_prompt || undefined,
    modelPrompt: row.model_prompt || undefined,
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
    !reference.thumbnailUrl &&
    !reference.thumbnailPath,
  )
}

function rowNeedsThumbnailBackfill(row: ImageHistoryRow) {
  return Boolean(
    (isInlineDataUrl(row.data_url) || isHttpUrl(row.data_url) || row.storage_path) &&
    !row.thumbnail_url &&
    !row.thumbnail_path,
  ) || Boolean(row.reference_images?.some(referenceNeedsThumbnailBackfill))
}

function rowMayNeedThumbnailBackfill(row: ImageHistoryRow) {
  return Boolean(
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
      next.thumbnailUrl = stored.thumbnailUrl
      next.thumbnailPath = stored.thumbnailPath
    }
    return next
  }

  if (!reference.thumbnailUrl && !reference.thumbnailPath) {
    const sourceUrl = isHttpUrl(reference.dataUrl)
      ? reference.dataUrl
      : imagePublicUrl(reference.storagePath)
    if (sourceUrl) {
      const { buffer } = await fetchImageBuffer(sourceUrl)
      const thumbnail = await storeThumbnailBuffer(buffer, pathHint)
      if (thumbnail) {
        next.thumbnailUrl = thumbnail.thumbnailUrl
        next.thumbnailPath = thumbnail.thumbnailPath
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
      updates.thumbnail_url = stored.thumbnailUrl
      updates.thumbnail_path = stored.thumbnailPath
    }
  } else if (!row.thumbnail_url && !row.thumbnail_path) {
    const sourceUrl = isHttpUrl(row.data_url) ? row.data_url : imagePublicUrl(row.storage_path)
    if (sourceUrl) {
      const { buffer } = await fetchImageBuffer(sourceUrl)
      const thumbnail = await storeThumbnailBuffer(buffer, `generated/${row.id}`)
      if (thumbnail) {
        updates.thumbnail_url = thumbnail.thumbnailUrl
        updates.thumbnail_path = thumbnail.thumbnailPath
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
        console.log(`[image-history] backfilled thumbnail for ${row.id}`)
      } catch (err) {
        console.warn('[image-history] thumbnail backfill skipped:', err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.warn('[image-history] thumbnail backfill lookup skipped:', err instanceof Error ? err.message : err)
  }
}

function historyClient() {
  return getSupabaseAdminClient()
}

export function hasImageHistoryStore() {
  return Boolean(historyClient())
}

export async function listImageHistory(limit = DEFAULT_HISTORY_LIMIT, offset = 0) {
  const client = historyClient()
  const cappedLimit = Math.max(1, Math.min(MAX_HISTORY_LIMIT, limit))
  const safeOffset = Math.max(0, offset)
  if (!client) {
    return {
      images: [],
      total: 0,
      limit: cappedLimit,
      offset: safeOffset,
      hasMore: false,
      nextOffset: null,
    }
  }

  const { data, error, count } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select(IMAGE_HISTORY_LIST_COLUMNS, { count: 'exact' })
    .order('generated_at', { ascending: false })
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

export async function getImageHistory(id: string) {
  const client = historyClient()
  if (!client) return null

  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? imageFromRow(data as ImageHistoryRow) : null
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

    throw error
  }

  return storedImages
}

export async function deleteImageHistory(id: string) {
  const client = historyClient()
  if (!client) return false

  const { error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .delete()
    .eq('id', id)

  if (error) throw error
  return true
}

export async function clearImageHistory() {
  const client = historyClient()
  if (!client) return false

  const { error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .delete()
    .neq('id', '')

  if (error) throw error
  return true
}
