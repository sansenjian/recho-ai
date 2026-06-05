import { getSupabaseAdminClient } from '../clients/supabase.js'
import {
  imagePublicUrl,
  storeImageDataUrl,
  storePreviewBuffer,
  storeThumbnailBuffer,
} from '../services/image-storage.js'

const TABLE = 'image_generations'
const BATCH_SIZE = 50

interface HistoryRow {
  id: string
  data_url?: string | null
  storage_path?: string | null
  preview_url?: string | null
  preview_path?: string | null
  thumbnail_url?: string | null
  thumbnail_path?: string | null
  reference_images?: Array<{
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
  }> | null
}

function isDataUrl(value?: string | null) {
  return Boolean(value && /^data:/i.test(value))
}

function isHttpUrl(value?: string | null) {
  return Boolean(value && /^https?:\/\//i.test(value))
}

async function fetchImage(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`)
  const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mime,
  }
}

async function backfillMainImage(row: HistoryRow) {
  const updates: Partial<HistoryRow> = {}

  if (isDataUrl(row.data_url)) {
    const stored = await storeImageDataUrl(row.data_url!, `generated/${row.id}`)
    if (stored) {
      updates.data_url = stored.publicUrl
      updates.storage_path = stored.storagePath
      updates.preview_url = stored.previewUrl
      updates.preview_path = stored.previewPath
      updates.thumbnail_url = stored.thumbnailUrl
      updates.thumbnail_path = stored.thumbnailPath
    }
    return updates
  }

  if ((!row.preview_url && !row.preview_path) || (!row.thumbnail_url && !row.thumbnail_path)) {
    const sourceUrl = isHttpUrl(row.data_url) ? row.data_url : imagePublicUrl(row.storage_path)
    if (sourceUrl) {
      const { buffer } = await fetchImage(sourceUrl)
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

  return updates
}

async function backfillReference(row: HistoryRow, reference: NonNullable<HistoryRow['reference_images']>[number], index: number) {
  const next = { ...reference }
  const pathHint = `references/${row.id}/${reference.id || `ref_${index + 1}`}`

  if (isDataUrl(reference.dataUrl)) {
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
      const { buffer } = await fetchImage(sourceUrl)
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

function referenceNeedsBackfill(reference: NonNullable<HistoryRow['reference_images']>[number]) {
  return isDataUrl(reference.dataUrl) ||
    Boolean(
      (isHttpUrl(reference.dataUrl) || reference.storagePath) &&
      (
        (!reference.previewUrl && !reference.previewPath) ||
        (!reference.thumbnailUrl && !reference.thumbnailPath)
      ),
    )
}

function rowNeedsBackfill(row: HistoryRow) {
  return isDataUrl(row.data_url) ||
    Boolean(
      (isHttpUrl(row.data_url) || row.storage_path) &&
      (
        (!row.preview_url && !row.preview_path) ||
        (!row.thumbnail_url && !row.thumbnail_path)
      ),
    ) ||
    Boolean(row.reference_images?.some(referenceNeedsBackfill))
}

async function main() {
  const client = getSupabaseAdminClient()
  if (!client) throw new Error('Supabase service role is not configured')

  let offset = 0
  let scanned = 0
  let updated = 0

  while (true) {
    const { data, error } = await client
      .from(TABLE)
      .select('id,data_url,storage_path,preview_url,preview_path,thumbnail_url,thumbnail_path,reference_images')
      .order('generated_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw error
    const rows = (data || []) as HistoryRow[]
    if (!rows.length) break

    for (const row of rows) {
      scanned += 1
      if (!rowNeedsBackfill(row)) continue

      const updates = await backfillMainImage(row)
      if (row.reference_images?.some(referenceNeedsBackfill)) {
        updates.reference_images = await Promise.all(
          row.reference_images.map((reference, index) => backfillReference(row, reference, index)),
        )
      }

      if (!Object.keys(updates).length) continue

      const { error: updateError } = await client
        .from(TABLE)
        .update(updates)
        .eq('id', row.id)

      if (updateError) throw updateError
      updated += 1
      console.log(`[backfill] updated ${row.id}`)
    }

    offset += rows.length
  }

  console.log(`[backfill] scanned=${scanned}, updated=${updated}`)
}

main().catch((err) => {
  console.error('[backfill] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
