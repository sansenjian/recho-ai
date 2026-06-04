import { ref, toRaw } from 'vue'
import { getAuthAccessToken } from './useAuthSession'
import type { GeneratedImage, ImageGenReference, ImageGenRequest, ImageGenResponse } from '../types/image'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const STORAGE_KEY = 'recho-image-history'
const DB_NAME = 'recho-image-history-db'
const DB_VERSION = 1
const DB_STORE = 'images'
const MAX_HISTORY = 50
const HISTORY_PAGE_SIZE = 12
const LOCAL_STORAGE_FALLBACK_LIMIT = 2
const IMAGE_REQUEST_TIMEOUT_MS = 360_000
type ImageGenOptions = Omit<ImageGenRequest, 'prompt'>

interface ImageHistoryResponse {
  images?: GeneratedImage[]
  hasMore?: boolean
  nextOffset?: number | null
}

interface ImageHistoryDetailResponse {
  image?: GeneratedImage
}

function plainReference(reference: ImageGenReference): ImageGenReference | null {
  const raw = toRaw(reference) as ImageGenReference
  if (!raw?.dataUrl) return null

  return {
    id: String(raw.id || ''),
    title: String(raw.title || '参考图'),
    dataUrl: String(raw.dataUrl),
    ...(raw.storagePath ? { storagePath: String(raw.storagePath) } : {}),
    ...(raw.thumbnailUrl ? { thumbnailUrl: String(raw.thumbnailUrl) } : {}),
    ...(raw.thumbnailPath ? { thumbnailPath: String(raw.thumbnailPath) } : {}),
    ...(raw.content ? { content: String(raw.content) } : {}),
    ...(raw.fileName ? { fileName: String(raw.fileName) } : {}),
  }
}

function plainHistoryImage(image: GeneratedImage): GeneratedImage | null {
  const raw = toRaw(image) as GeneratedImage
  if (!raw?.id || (!raw?.dataUrl && !raw?.thumbnailUrl)) return null

  const references = Array.isArray(raw.references)
    ? raw.references
      .map(reference => plainReference(reference))
      .filter((reference): reference is ImageGenReference => Boolean(reference))
    : []

  return {
    id: String(raw.id),
    ...(raw.dataUrl ? { dataUrl: String(raw.dataUrl) } : {}),
    ...(raw.storagePath ? { storagePath: String(raw.storagePath) } : {}),
    ...(raw.thumbnailUrl ? { thumbnailUrl: String(raw.thumbnailUrl) } : {}),
    ...(raw.thumbnailPath ? { thumbnailPath: String(raw.thumbnailPath) } : {}),
    prompt: String(raw.prompt || ''),
    references,
    ...(raw.revisedPrompt ? { revisedPrompt: String(raw.revisedPrompt) } : {}),
    size: String(raw.size || 'auto'),
    aspectRatio: raw.aspectRatio,
    resolution: raw.resolution,
    quality: raw.quality,
    timestamp: String(raw.timestamp || new Date().toISOString()),
  }
}

function sortHistory(images: GeneratedImage[]) {
  return images
    .map(image => plainHistoryImage(image))
    .filter((item): item is GeneratedImage => Boolean(item))
    .sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''))
}

function uniqueHistory(images: GeneratedImage[]) {
  const seen = new Set<string>()
  return sortHistory(images).filter((image) => {
    if (seen.has(image.id)) return false
    seen.add(image.id)
    return true
  }).slice(0, MAX_HISTORY)
}

function loadLegacyHistory(): GeneratedImage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? uniqueHistory(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function saveLegacyHistory(images: GeneratedImage[]) {
  try {
    const compact = uniqueHistory(images).slice(0, LOCAL_STORAGE_FALLBACK_LIMIT)
    if (compact.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compact))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (err) {
    console.warn('[image-history] localStorage fallback failed', err)
  }
}

function clearLegacyHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* unavailable */ }
}

function openHistoryDb(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null)

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      console.warn('[image-history] IndexedDB open failed', request.error)
      resolve(null)
    }
    request.onblocked = () => {
      console.warn('[image-history] IndexedDB upgrade blocked')
      resolve(null)
    }
  })
}

function readAllFromDb(db: IDBDatabase): Promise<GeneratedImage[]> {
  return new Promise((resolve) => {
    const transaction = db.transaction(DB_STORE, 'readonly')
    const request = transaction.objectStore(DB_STORE).getAll()

    request.onsuccess = () => resolve(uniqueHistory(request.result as GeneratedImage[]))
    request.onerror = () => {
      console.warn('[image-history] IndexedDB read failed', request.error)
      resolve([])
    }
  })
}

function writeAllToDb(db: IDBDatabase, images: GeneratedImage[]): Promise<boolean> {
  return new Promise((resolve) => {
    const transaction = db.transaction(DB_STORE, 'readwrite')
    const store = transaction.objectStore(DB_STORE)

    try {
      store.clear()
      for (const image of uniqueHistory(images)) {
        store.put(image)
      }
    } catch (err) {
      console.warn('[image-history] IndexedDB clone failed', err)
      try {
        transaction.abort()
      } catch { /* already closed */ }
      resolve(false)
      return
    }

    transaction.oncomplete = () => resolve(true)
    transaction.onerror = () => {
      console.warn('[image-history] IndexedDB write failed', transaction.error)
      resolve(false)
    }
    transaction.onabort = () => {
      console.warn('[image-history] IndexedDB write aborted', transaction.error)
      resolve(false)
    }
  })
}

async function loadPersistedHistory() {
  const db = await openHistoryDb()
  if (!db) return loadLegacyHistory()

  try {
    const stored = await readAllFromDb(db)
    const legacy = loadLegacyHistory()
    const merged = uniqueHistory([...stored, ...legacy])
    if (legacy.length) {
      const migrated = await writeAllToDb(db, merged)
      if (migrated) clearLegacyHistory()
    }
    return merged
  } finally {
    db.close()
  }
}

async function loadRemoteHistory(offset = 0) {
  try {
    const query = new URLSearchParams({
      limit: String(HISTORY_PAGE_SIZE),
      offset: String(offset),
    })
    const res = await fetch(`${API_BASE}/api/image/history?${query.toString()}`, { cache: 'no-store' })
    if (!res.ok) return { images: [], hasMore: false, nextOffset: null }
    const data = await res.json() as ImageHistoryResponse
    return {
      images: uniqueHistory(data.images || []),
      hasMore: Boolean(data.hasMore),
      nextOffset: typeof data.nextOffset === 'number' ? data.nextOffset : null,
    }
  } catch (err) {
    console.warn('[image-history] Supabase history load failed', err)
    return { images: [], hasMore: false, nextOffset: null }
  }
}

async function loadRemoteImageDetail(id: string) {
  try {
    const res = await fetch(`${API_BASE}/api/image/history/${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json() as ImageHistoryDetailResponse
    return data.image ? plainHistoryImage(data.image) : null
  } catch (err) {
    console.warn('[image-history] Supabase history detail load failed', err)
    return null
  }
}

async function saveHistory(images: GeneratedImage[]) {
  const capped = uniqueHistory(images)
  const db = await openHistoryDb()
  if (!db) {
    saveLegacyHistory(capped)
    return
  }

  try {
    const saved = await writeAllToDb(db, capped)
    if (saved) {
      clearLegacyHistory()
    } else {
      saveLegacyHistory(capped)
    }
  } finally {
    db.close()
  }
}

async function deleteRemoteHistory(id: string) {
  try {
    await fetch(`${API_BASE}/api/image/history/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch (err) {
    console.warn('[image-history] Supabase history delete failed', err)
  }
}

export function useImageGen() {
  const isGenerating = ref(false)
  const isLoadingHistory = ref(false)
  const hasMoreHistory = ref(false)
  const nextHistoryOffset = ref<number | null>(null)
  const error = ref<string | null>(null)
  const generatedImages = ref<GeneratedImage[]>(loadLegacyHistory())

  void Promise.all([loadPersistedHistory(), loadRemoteHistory(0)]).then(([history, remoteHistory]) => {
    generatedImages.value = uniqueHistory([...generatedImages.value, ...history, ...remoteHistory.images])
    hasMoreHistory.value = remoteHistory.hasMore
    nextHistoryOffset.value = remoteHistory.nextOffset
    void saveHistory(generatedImages.value)
  })

  async function generate(prompt: string, options: ImageGenOptions = {}): Promise<GeneratedImage | null> {
    error.value = null
    isGenerating.value = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)

    try {
      const token = await getAuthAccessToken()
      const res = await fetch(`${API_BASE}/api/image/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, ...options }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let msg = res.statusText
        try {
          const errJson = await res.json()
          msg = errJson.error || msg
        } catch { /* */ }
        throw new Error(msg)
      }

      const data: ImageGenResponse = await res.json()
      const image = data.images?.[0]
      if (!image?.dataUrl) {
        throw new Error('no image returned')
      }

      const imageWithReferences: GeneratedImage = {
        ...image,
        references: image.references?.length
          ? image.references.map(reference => ({ ...reference }))
          : options.references?.map(reference => ({ ...reference })) ?? [],
      }

      generatedImages.value = [imageWithReferences, ...generatedImages.value]
      void saveHistory(generatedImages.value)
      return imageWithReferences
    } catch (err: any) {
      error.value = err?.name === 'AbortError'
        ? '图片生成请求超时，请减少参考图数量或稍后重试。'
        : err.message || 'image generation failed'
      return null
    } finally {
      window.clearTimeout(timeoutId)
      isGenerating.value = false
    }
  }

  function removeImage(id: string) {
    generatedImages.value = generatedImages.value.filter(img => img.id !== id)
    void saveHistory(generatedImages.value)
    void deleteRemoteHistory(id)
  }

  function clearHistory() {
    return
  }

  async function resolveImageDetail(image: GeneratedImage) {
    if (image.dataUrl) return image

    const detail = await loadRemoteImageDetail(image.id)
    if (!detail) return image

    generatedImages.value = uniqueHistory([detail, ...generatedImages.value])
    void saveHistory(generatedImages.value)
    return detail
  }

  async function loadMoreHistory() {
    if (isLoadingHistory.value || !hasMoreHistory.value || nextHistoryOffset.value === null) return
    isLoadingHistory.value = true
    try {
      const remoteHistory = await loadRemoteHistory(nextHistoryOffset.value)
      generatedImages.value = uniqueHistory([...generatedImages.value, ...remoteHistory.images])
      hasMoreHistory.value = remoteHistory.hasMore
      nextHistoryOffset.value = remoteHistory.nextOffset
      void saveHistory(generatedImages.value)
    } finally {
      isLoadingHistory.value = false
    }
  }

  return {
    isGenerating,
    isLoadingHistory,
    hasMoreHistory,
    error,
    generatedImages,
    generate,
    removeImage,
    clearHistory,
    loadMoreHistory,
    resolveImageDetail,
  }
}
