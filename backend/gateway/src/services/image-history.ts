import { getSupabaseAdminClient } from '../clients/supabase.js'

const IMAGE_HISTORY_TABLE = 'image_generations'
const MAX_HISTORY_LIMIT = 50

export interface ImageHistoryReference {
  id?: string
  title?: string
  dataUrl: string
  content?: string
  fileName?: string
}

export interface ImageHistoryItem {
  id: string
  dataUrl: string
  prompt: string
  references?: ImageHistoryReference[]
  revisedPrompt?: string
  size: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  timestamp: string
}

interface ImageHistoryRow {
  id: string
  data_url: string
  prompt: string
  revised_prompt: string | null
  size: string
  aspect_ratio: string | null
  resolution: string | null
  quality: string | null
  reference_images: ImageHistoryReference[] | null
  generated_at: string
}

function plainReference(reference: ImageHistoryReference): ImageHistoryReference | null {
  if (!reference?.dataUrl) return null

  return {
    id: reference.id ? String(reference.id) : undefined,
    title: reference.title ? String(reference.title) : '参考图',
    dataUrl: String(reference.dataUrl),
    content: reference.content ? String(reference.content) : undefined,
    fileName: reference.fileName ? String(reference.fileName) : undefined,
  }
}

function plainReferences(references: ImageHistoryReference[] = []) {
  return references
    .map(reference => plainReference(reference))
    .filter((reference): reference is ImageHistoryReference => Boolean(reference))
}

function rowFromImage(image: ImageHistoryItem): ImageHistoryRow {
  return {
    id: String(image.id),
    data_url: String(image.dataUrl),
    prompt: String(image.prompt || ''),
    revised_prompt: image.revisedPrompt ? String(image.revisedPrompt) : null,
    size: String(image.size || 'auto'),
    aspect_ratio: image.aspectRatio ? String(image.aspectRatio) : null,
    resolution: image.resolution ? String(image.resolution) : null,
    quality: image.quality ? String(image.quality) : null,
    reference_images: plainReferences(image.references),
    generated_at: String(image.timestamp || new Date().toISOString()),
  }
}

function imageFromRow(row: ImageHistoryRow): ImageHistoryItem {
  return {
    id: row.id,
    dataUrl: row.data_url,
    prompt: row.prompt || '',
    references: plainReferences(row.reference_images || []),
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

export async function listImageHistory(limit = MAX_HISTORY_LIMIT) {
  const client = historyClient()
  if (!client) return []

  const { data, error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .select('id,data_url,prompt,revised_prompt,size,aspect_ratio,resolution,quality,reference_images,generated_at')
    .order('generated_at', { ascending: false })
    .limit(Math.max(1, Math.min(MAX_HISTORY_LIMIT, limit)))

  if (error) throw error
  return (data || []).map(row => imageFromRow(row as ImageHistoryRow))
}

export async function saveImageHistory(images: ImageHistoryItem[]) {
  const client = historyClient()
  if (!client || !images.length) return false

  const rows = images
    .filter(image => image?.id && image?.dataUrl)
    .map(rowFromImage)

  if (!rows.length) return false

  const { error } = await client
    .from(IMAGE_HISTORY_TABLE)
    .upsert(rows, { onConflict: 'id' })

  if (error) throw error
  return true
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
