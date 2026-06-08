import { getSupabaseAdminClient } from '../clients/supabase.js'
import {
  imagePublicUrl,
  storeImageBuffer,
  storeImageDataUrl,
} from './image-storage.js'

const IMAGE_HISTORY_TABLE = 'image_generations'
const MAX_HISTORY_LIMIT = 50
const DEFAULT_HISTORY_LIMIT = 12

function withoutColumn(columns: string, column: string) {
  return columns
    .split(',')
    .filter(item => item !== column)
    .join(',')
}

const IMAGE_HISTORY_BATCH_LIST_COLUMNS = [
  'id',
  'user_id',
  'generation_batch_id',
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
  'visibility',
  'funding_source',
  'credit_cost',
  'credit_transaction_id',
  'prompt',
  'user_prompt',
  'revised_prompt',
  'size',
  'aspect_ratio',
  'resolution',
  'quality',
  'reference_images',
  'reference_count',
  'generated_at',
].join(',')
const IMAGE_HISTORY_BATCH_LIST_COLUMNS_WITHOUT_REFERENCE_COUNT = withoutColumn(
  IMAGE_HISTORY_BATCH_LIST_COLUMNS,
  'reference_count',
)
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
  'visibility',
  'funding_source',
  'credit_cost',
  'credit_transaction_id',
  'prompt',
  'user_prompt',
  'revised_prompt',
  'size',
  'aspect_ratio',
  'resolution',
  'quality',
  'reference_images',
  'reference_count',
  'generated_at',
].join(',')
const IMAGE_HISTORY_LIST_COLUMNS_WITHOUT_REFERENCE_COUNT = withoutColumn(
  IMAGE_HISTORY_LIST_COLUMNS,
  'reference_count',
)
const IMAGE_HISTORY_PUBLIC_SUMMARY_COLUMNS = [
  'id',
  'storage_path',
  'preview_url',
  'preview_path',
  'thumbnail_url',
  'thumbnail_path',
  'prompt',
  'user_prompt',
  'size',
  'aspect_ratio',
  'resolution',
  'quality',
  'reference_count',
  'generated_at',
].join(',')
const IMAGE_HISTORY_LEGACY_LIST_COLUMNS = [
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
export type ImageHistoryScope = 'public' | 'mine'
export type ImageVisibility = 'public' | 'private'
export type ImageFundingSource = 'free' | 'credit'

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
  generationBatchId?: string | null
  sourceBuffer?: Buffer
  sourceMime?: string
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
  referenceImageCount?: number
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
  visibility?: ImageVisibility
  fundingSource?: ImageFundingSource
  creditCost?: number
  creditTransactionId?: string | null
  size: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  timestamp: string
}

interface ImageHistoryRow {
  id: string
  user_id?: string | null
  generation_batch_id?: string | null
  data_url?: string | null
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
  visibility?: ImageVisibility | null
  funding_source?: ImageFundingSource | null
  credit_cost?: number | null
  credit_transaction_id?: string | null
  size: string
  aspect_ratio: string | null
  resolution: string | null
  quality: string | null
  reference_images?: ImageHistoryReference[] | null
  reference_count?: number | null
  generated_at: string
}

function plainReference(reference: ImageHistoryReference): ImageHistoryReference | null {
  if (
    !reference?.dataUrl &&
    !reference?.storagePath &&
    !reference?.previewUrl &&
    !reference?.previewPath &&
    !reference?.thumbnailUrl &&
    !reference?.thumbnailPath
  ) {
    return null
  }

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

function referenceRecord(reference: ImageHistoryReference): ImageHistoryReference | null {
  const plain = plainReference(reference)
  if (!plain) return null

  return {
    id: plain.id,
    title: plain.title,
    storagePath: plain.storagePath,
    previewPath: plain.previewPath,
    thumbnailPath: plain.thumbnailPath,
    ...(!plain.storagePath && !plain.previewPath && !plain.thumbnailPath && plain.dataUrl ? { dataUrl: plain.dataUrl } : {}),
    content: plain.content,
    fileName: plain.fileName,
  }
}

function referenceRecords(references: ImageHistoryReference[] = []) {
  return references
    .map(reference => referenceRecord(reference))
    .filter((reference): reference is ImageHistoryReference => Boolean(reference))
}

interface StoreImageContext {
  referenceCache: Map<string, Promise<ImageHistoryReference | null>>
}

function referencePathId(reference: ImageHistoryReference, index: number) {
  return reference.id ? String(reference.id) : `ref_${index + 1}`
}

function withoutSourcePayload(image: ImageHistoryItem): ImageHistoryItem {
  const {
    sourceBuffer: _sourceBuffer,
    sourceMime: _sourceMime,
    ...publicImage
  } = image
  return publicImage
}

async function storedReference(
  reference: ImageHistoryReference,
  batchId: string,
  index: number,
  context: StoreImageContext,
) {
  const plain = plainReference(reference)
  if (!plain?.dataUrl) return plain
  if (!isInlineDataUrl(plain.dataUrl)) return plain

  const pathId = referencePathId(plain, index)
  const cacheKey = `${batchId}:${pathId}`
  const cached = context.referenceCache.get(cacheKey)
  if (cached) return await cached

  const storedReferencePromise = storeImageDataUrl(plain.dataUrl, `references/${batchId}/${pathId}`)
    .then(stored => stored
      ? {
        ...plain,
        dataUrl: stored.previewUrl || stored.publicUrl,
        storagePath: stored.storagePath,
        previewUrl: stored.previewUrl,
        previewPath: stored.previewPath,
        thumbnailUrl: stored.thumbnailUrl,
        thumbnailPath: stored.thumbnailPath,
      }
      : plain)

  context.referenceCache.set(cacheKey, storedReferencePromise)
  return await storedReferencePromise
}

async function storedImage(image: ImageHistoryItem, context: StoreImageContext) {
  const id = String(image.id)
  const stored = image.sourceBuffer
    ? await storeImageBuffer(image.sourceBuffer, image.sourceMime || 'image/png', `generated/${id}`)
    : image.dataUrl
      ? await storeImageDataUrl(String(image.dataUrl), `generated/${id}`)
      : null
  const referenceBatchId = image.generationBatchId || id
  const references: ImageHistoryReference[] = []

  for (const [index, reference] of plainReferences(image.references).entries()) {
    const stored = await storedReference(reference, referenceBatchId, index, context)
    if (stored) references.push(stored)
  }

  return withoutSourcePayload({
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
    references,
  })
}

interface ImageRowOptions {
  includeBatch?: boolean
  includeNullableDataUrl?: boolean
  includeThumbnails?: boolean
  includeUserId?: boolean
  includePromptDetails?: boolean
  includeRequestMeta?: boolean
  includeMetrics?: boolean
  includeCredits?: boolean
  includeReferenceCount?: boolean
}

function rowFromImage(image: ImageHistoryItem, options: ImageRowOptions = {}): ImageHistoryRow {
  const userPrompt = String(image.userPrompt || image.prompt || '')
  const references = referenceRecords(image.references)
  const row: ImageHistoryRow = {
    id: String(image.id),
    data_url: options.includeNullableDataUrl !== false && image.storagePath ? null : String(image.dataUrl || ''),
    storage_path: image.storagePath ? String(image.storagePath) : null,
    prompt: userPrompt,
    revised_prompt: image.revisedPrompt ? String(image.revisedPrompt) : null,
    size: String(image.size || 'auto'),
    aspect_ratio: image.aspectRatio ? String(image.aspectRatio) : null,
    resolution: image.resolution ? String(image.resolution) : null,
    quality: image.quality ? String(image.quality) : null,
    reference_images: references,
    generated_at: String(image.timestamp || new Date().toISOString()),
  }

  if (options.includeReferenceCount !== false) {
    row.reference_count = typeof image.referenceImageCount === 'number'
      ? Math.max(0, Math.round(image.referenceImageCount))
      : references.length
  }

  if (options.includeBatch !== false && image.generationBatchId) {
    row.generation_batch_id = String(image.generationBatchId)
  }

  if (options.includeCredits !== false) {
    row.visibility = image.visibility === 'private' ? 'private' : 'public'
    row.funding_source = image.fundingSource === 'credit' ? 'credit' : 'free'
    row.credit_cost = typeof image.creditCost === 'number' ? Math.max(0, Math.round(image.creditCost)) : 0
    row.credit_transaction_id = image.creditTransactionId ? String(image.creditTransactionId) : null
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
  if (/generation_batch_id/i.test(message)) return 'batch'
  if (/(preview|thumbnail)_(url|path)/i.test(message)) return 'thumbnail'
  if (/user_id/i.test(message)) return 'user_id'
  if (/(user_prompt|system_prompt|model_prompt)/i.test(message)) return 'prompt_detail'
  if (/(request_ip|request_user_agent)/i.test(message)) return 'request_meta'
  if (/(provider|image_model|text_model|latency_ms|image_width|image_height|original_bytes|preview_bytes|thumbnail_bytes)/i.test(message)) return 'metrics'
  if (/(visibility|funding_source|credit_cost|credit_transaction_id)/i.test(message)) return 'credits'
  if (/reference_count/i.test(message)) return 'reference_count'
  return null
}

function missingBatchHistorySchema(error: { message?: string; code?: string }) {
  return missingOptionalColumn(error) === 'batch' ||
    (error.code === '42703' && /generation_batch_id/i.test(error.message || ''))
}

function missingCreditHistorySchema(error: { message?: string; code?: string }) {
  const message = error.message || ''
  return missingOptionalColumn(error) === 'credits' ||
    (error.code === '42703' && /(visibility|funding_source|credit_cost|credit_transaction_id)/i.test(message))
}

function missingReferenceCountHistorySchema(error: { message?: string; code?: string }) {
  return missingOptionalColumn(error) === 'reference_count' ||
    (error.code === '42703' && /reference_count/i.test(error.message || ''))
}

function missingNullableDataUrlSchema(error: { message?: string; code?: string }) {
  return error.code === '23502' && /data_url/i.test(error.message || '')
}

function imageFromRow(row: ImageHistoryRow, options: { includeOriginal?: boolean } = {}): ImageHistoryItem {
  const previewPath = row.preview_path || undefined
  const originalUrl = row.data_url || imagePublicUrl(row.storage_path) || ''
  const previewUrl = row.preview_url || imagePublicUrl(previewPath) || originalUrl || undefined
  const thumbnailPath = row.thumbnail_path || undefined
  const thumbnailUrl = row.thumbnail_url || imagePublicUrl(thumbnailPath) || previewUrl
  const userPrompt = row.user_prompt || row.prompt || ''
  const references = referencesFromRow(row)
  return {
    id: row.id,
    userId: row.user_id || null,
    generationBatchId: row.generation_batch_id || null,
    ...(options.includeOriginal && originalUrl ? { dataUrl: originalUrl } : {}),
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
    visibility: row.visibility || 'public',
    fundingSource: row.funding_source || 'free',
    creditCost: row.credit_cost ?? undefined,
    creditTransactionId: row.credit_transaction_id || undefined,
    references,
    referenceImageCount: typeof row.reference_count === 'number' ? row.reference_count : references.length,
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

function referenceSummary(reference: ImageHistoryReference): ImageHistoryReference | null {
  const plain = plainReference(reference)
  if (!plain) return null
  const previewUrl = plain.previewUrl || imagePublicUrl(plain.previewPath)
  const thumbnailUrl = plain.thumbnailUrl || imagePublicUrl(plain.thumbnailPath)
  const originalUrl = imagePublicUrl(plain.storagePath)
  const displayUrl = thumbnailUrl || previewUrl || originalUrl || (!isInlineDataUrl(plain.dataUrl) ? plain.dataUrl : undefined)

  return {
    id: plain.id,
    title: plain.title,
    dataUrl: displayUrl,
    storagePath: plain.storagePath,
    previewUrl,
    previewPath: plain.previewPath,
    thumbnailUrl,
    thumbnailPath: plain.thumbnailPath,
    content: plain.content,
    fileName: plain.fileName,
  }
}

function referencesFromRow(row: ImageHistoryRow) {
  return plainReferences(row.reference_images || [])
    .map(referenceSummary)
    .filter((reference): reference is ImageHistoryReference => Boolean(reference))
}

function imageSummaryFromRow(row: ImageHistoryRow): ImageHistoryItem {
  const previewPath = row.preview_path || undefined
  const originalUrl = imagePublicUrl(row.storage_path) || ''
  const previewUrl = row.preview_url || imagePublicUrl(previewPath) || originalUrl || undefined
  const thumbnailPath = row.thumbnail_path || undefined
  const thumbnailUrl = row.thumbnail_url || imagePublicUrl(thumbnailPath) || previewUrl
  const userPrompt = row.user_prompt || row.prompt || ''
  const references = row.reference_images ? referencesFromRow(row) : []
  return {
    id: row.id,
    userId: row.user_id || null,
    generationBatchId: row.generation_batch_id || null,
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
    visibility: row.visibility || 'public',
    fundingSource: row.funding_source || 'free',
    creditCost: row.credit_cost ?? undefined,
    creditTransactionId: row.credit_transaction_id || undefined,
    references,
    referenceImageCount: typeof row.reference_count === 'number' ? row.reference_count : references.length,
    revisedPrompt: row.revised_prompt || undefined,
    size: row.size || 'auto',
    aspectRatio: row.aspect_ratio || undefined,
    resolution: row.resolution || undefined,
    quality: row.quality || undefined,
    timestamp: row.generated_at,
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

  const listWithColumns = async (columns: string, includeVisibilityFilter: boolean) => {
    let query = client
      .from(IMAGE_HISTORY_TABLE)
      .select(columns)
      .order('generated_at', { ascending: false })

    if (options.scope === 'mine') {
      query = query.eq('user_id', options.userId!)
    } else if (includeVisibilityFilter) {
      query = query.eq('visibility', 'public')
    }

    return await query.range(safeOffset, safeOffset + cappedLimit)
  }

  const publicScope = options.scope !== 'mine'
  let referenceCountColumnMissing = false
  let result = await listWithColumns(
    publicScope ? IMAGE_HISTORY_PUBLIC_SUMMARY_COLUMNS : IMAGE_HISTORY_BATCH_LIST_COLUMNS,
    true,
  )
  if (result.error && missingReferenceCountHistorySchema(result.error)) {
    referenceCountColumnMissing = true
    console.warn('[image-history] reference count column missing; listing with full reference metadata')
    result = await listWithColumns(IMAGE_HISTORY_BATCH_LIST_COLUMNS_WITHOUT_REFERENCE_COUNT, true)
  }
  if (result.error && missingBatchHistorySchema(result.error)) {
    console.warn('[image-history] generation batch column missing; listing without batch metadata')
    result = await listWithColumns(
      referenceCountColumnMissing
        ? IMAGE_HISTORY_LIST_COLUMNS_WITHOUT_REFERENCE_COUNT
        : IMAGE_HISTORY_LIST_COLUMNS,
      true,
    )
  }
  if (result.error && !referenceCountColumnMissing && missingReferenceCountHistorySchema(result.error)) {
    referenceCountColumnMissing = true
    console.warn('[image-history] reference count column missing; retrying list with full reference metadata')
    result = await listWithColumns(IMAGE_HISTORY_LIST_COLUMNS_WITHOUT_REFERENCE_COUNT, true)
  }
  if (result.error && missingCreditHistorySchema(result.error)) {
    console.warn('[image-history] credit visibility columns missing; listing legacy public history')
    result = await listWithColumns(IMAGE_HISTORY_LEGACY_LIST_COLUMNS, false)
  }

  const { data, error } = result

  if (error) throw error
  const rows = (data || []) as unknown as ImageHistoryRow[]
  const hasMore = rows.length > cappedLimit
  const visibleRows = hasMore ? rows.slice(0, cappedLimit) : rows
  const images = visibleRows.map(row => imageSummaryFromRow(row))
  const nextOffset = safeOffset + images.length
  return {
    images,
    total: nextOffset + (hasMore ? 1 : 0),
    limit: cappedLimit,
    offset: safeOffset,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  }
}

export async function getImageHistory(id: string, options: ImageHistoryAccessOptions = {}) {
  const client = historyClient()
  if (!client || (options.scope === 'mine' && !options.userId)) return null

  const getRow = async (includeVisibilityFilter: boolean) => {
    let query = client
      .from(IMAGE_HISTORY_TABLE)
      .select('*')
      .eq('id', id)

    if (options.scope === 'mine') {
      query = query.eq('user_id', options.userId!)
    } else if (includeVisibilityFilter) {
      query = query.eq('visibility', 'public')
    }

    return await query.maybeSingle()
  }

  let result = await getRow(true)
  if (result.error && missingCreditHistorySchema(result.error)) {
    console.warn('[image-history] credit visibility columns missing; reading legacy public history detail')
    result = await getRow(false)
  }

  const { data, error } = result

  if (error) throw error
  if (!data) return null

  return imageFromRow(data as ImageHistoryRow, { includeOriginal: options.includeOriginal })
}

export async function saveImageHistory(images: ImageHistoryItem[], options: { userId?: string | null } = {}) {
  const client = historyClient()
  if (!client || !images.length) return null

  const storeContext: StoreImageContext = {
    referenceCache: new Map(),
  }
  const storedImages: ImageHistoryItem[] = []

  for (const image of images) {
    if (!image?.id || (!image.sourceBuffer && !image.dataUrl && !image.storagePath)) continue
    storedImages.push(await storedImage({
      ...image,
      ...(options.userId ? { userId: options.userId } : {}),
    }, storeContext))
  }

  const validImages = storedImages
    .filter(image => image?.id && (image.dataUrl || image.storagePath || image.previewUrl || image.thumbnailUrl))

  if (!validImages.length) return null
  const canOmitCreditFields = validImages.every(image => (
    image.visibility !== 'private' &&
    image.fundingSource !== 'credit' &&
    !image.creditCost &&
    !image.creditTransactionId
  ))

  const rowOptions: Required<ImageRowOptions> = {
    includeBatch: true,
    includeNullableDataUrl: true,
    includeThumbnails: true,
    includeUserId: true,
    includePromptDetails: true,
    includeRequestMeta: true,
    includeMetrics: true,
    includeCredits: true,
    includeReferenceCount: true,
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = validImages.map(image => rowFromImage(image, rowOptions))
    const { error } = await client
      .from(IMAGE_HISTORY_TABLE)
      .upsert(rows, { onConflict: 'id' })

    if (!error) return storedImages

    const missingColumn = missingOptionalColumn(error)
    if (missingNullableDataUrlSchema(error) && rowOptions.includeNullableDataUrl) {
      rowOptions.includeNullableDataUrl = false
      console.warn('[image-history] data_url still requires a value; retrying save with legacy empty data_url')
      continue
    }
    if (missingColumn === 'batch' && rowOptions.includeBatch) {
      rowOptions.includeBatch = false
      console.warn('[image-history] generation batch column missing; retrying save without batch field')
      continue
    }
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
    if (missingColumn === 'credits' && rowOptions.includeCredits) {
      if (!canOmitCreditFields) throw error
      rowOptions.includeCredits = false
      console.warn('[image-history] credit columns missing; retrying save without credit fields')
      continue
    }
    if (missingColumn === 'reference_count' && rowOptions.includeReferenceCount) {
      rowOptions.includeReferenceCount = false
      console.warn('[image-history] reference count column missing; retrying save without reference count')
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
