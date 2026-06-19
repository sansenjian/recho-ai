import { ref, toRaw, watch } from 'vue'
import { getAuthAccessToken, getAuthIdentity, useAuthSession } from './useAuthSession'
import { useCredits } from './useCredits'
import { ensureAppConfig } from './useAppConfig'
import { imageApiUrl } from '../lib/api-base'
import { publicClientErrorMessage } from '../lib/safe-error'
import type { GeneratedImage, ImageGenReference, ImageGenRequest, ImageGenResponse, ImageHistoryScope } from '../types/image'

const STORAGE_KEY = 'recho-private-image-history'
const DB_NAME = 'recho-private-image-history-db'
const DB_VERSION = 1
const DB_STORE = 'images'
const MAX_HISTORY = 50
const MAX_GALLERY_HISTORY = 240
const HISTORY_PAGE_SIZE = 12
const LOCAL_STORAGE_FALLBACK_LIMIT = 2
const IMAGE_REQUEST_TIMEOUT_MS = 360_000
type ImageGenOptions = Omit<ImageGenRequest, 'prompt'>
export type { ImageHistoryScope }

interface ImageHistoryResponse {
  images?: GeneratedImage[]
  hasMore?: boolean
  nextOffset?: number | null
}

interface ImageHistoryDetailResponse {
  image?: GeneratedImage
}

interface ResolveImageDetailOptions {
  includeOriginal?: boolean
  requireStoragePath?: boolean
}

function plainReference(reference: ImageGenReference): ImageGenReference | null {
  const raw = toRaw(reference) as ImageGenReference
  if (
    !raw?.dataUrl &&
    !raw?.storagePath &&
    !raw?.previewUrl &&
    !raw?.previewPath &&
    !raw?.thumbnailUrl &&
    !raw?.thumbnailPath
  ) {
    return null
  }

  return {
    id: String(raw.id || ''),
    title: String(raw.title || '参考图'),
    ...(raw.dataUrl ? { dataUrl: String(raw.dataUrl) } : {}),
    ...(raw.storagePath ? { storagePath: String(raw.storagePath) } : {}),
    ...(raw.previewUrl ? { previewUrl: String(raw.previewUrl) } : {}),
    ...(raw.previewPath ? { previewPath: String(raw.previewPath) } : {}),
    ...(raw.thumbnailUrl ? { thumbnailUrl: String(raw.thumbnailUrl) } : {}),
    ...(raw.thumbnailPath ? { thumbnailPath: String(raw.thumbnailPath) } : {}),
    ...(raw.content ? { content: String(raw.content) } : {}),
    ...(raw.fileName ? { fileName: String(raw.fileName) } : {}),
  }
}

function plainHistoryImage(image: GeneratedImage): GeneratedImage | null {
  const raw = toRaw(image) as GeneratedImage
  if (!raw?.id || (!raw?.dataUrl && !raw?.storagePath && !raw?.previewUrl && !raw?.thumbnailUrl)) return null

  const references = Array.isArray(raw.references)
    ? raw.references
      .map(reference => plainReference(reference))
      .filter((reference): reference is ImageGenReference => Boolean(reference))
    : []

  return {
    id: String(raw.id),
    ...(raw.userId !== undefined ? { userId: raw.userId ? String(raw.userId) : null } : {}),
    ...(raw.dataUrl ? { dataUrl: String(raw.dataUrl) } : {}),
    ...(raw.storagePath ? { storagePath: String(raw.storagePath) } : {}),
    ...(raw.previewUrl ? { previewUrl: String(raw.previewUrl) } : {}),
    ...(raw.previewPath ? { previewPath: String(raw.previewPath) } : {}),
    ...(raw.thumbnailUrl ? { thumbnailUrl: String(raw.thumbnailUrl) } : {}),
    ...(raw.thumbnailPath ? { thumbnailPath: String(raw.thumbnailPath) } : {}),
    prompt: String(raw.userPrompt || raw.prompt || ''),
    ...(raw.userPrompt ? { userPrompt: String(raw.userPrompt) } : {}),
    ...(raw.systemPrompt ? { systemPrompt: String(raw.systemPrompt) } : {}),
    ...(raw.modelPrompt ? { modelPrompt: String(raw.modelPrompt) } : {}),
    references,
    ...(typeof raw.referenceImageCount === 'number' ? { referenceImageCount: raw.referenceImageCount } : {}),
    ...(raw.revisedPrompt ? { revisedPrompt: String(raw.revisedPrompt) } : {}),
    ...(raw.visibility ? { visibility: raw.visibility } : {}),
    ...(raw.fundingSource ? { fundingSource: raw.fundingSource } : {}),
    ...(typeof raw.creditCost === 'number' ? { creditCost: raw.creditCost } : {}),
    size: String(raw.size || 'auto'),
    aspectRatio: raw.aspectRatio,
    resolution: raw.resolution,
    quality: raw.quality,
    timestamp: String(raw.timestamp || new Date().toISOString()),
  }
}

function isPublicGalleryImage(image: GeneratedImage) {
  return image.visibility !== 'private' && image.fundingSource !== 'credit'
}

function isRecoverableGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /AbortError|timeout|timed out|aborted|超时|Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_CLOSED|Load failed|network|socket hang up|ECONNRESET/i.test(message)
}

function normalizedPrompt(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function historyMatchesRequest(image: GeneratedImage, expectedPrompt: string, startedAt: number) {
  const timestamp = Date.parse(image.timestamp || '')
  if (!Number.isFinite(timestamp) || timestamp < startedAt - 5_000) return false
  if (!expectedPrompt) return true
  return normalizedPrompt(image.userPrompt || image.prompt) === expectedPrompt
}

async function readApiError(response: Response, fallback: string) {
  try {
    const errJson = await response.json()
    return publicClientErrorMessage(errJson.error || response.statusText, fallback)
  } catch {
    return publicClientErrorMessage(response.statusText, fallback)
  }
}

async function referenceDataToBlob(reference: ImageGenReference) {
  if (!reference.dataUrl) return null
  const response = await fetch(reference.dataUrl)
  if (!response.ok) return null
  const blob = await response.blob()
  return blob.size ? blob : null
}

function encodedHeader(value?: string) {
  const trimmed = value?.trim()
  return trimmed ? encodeURIComponent(trimmed.slice(0, 160)) : undefined
}

function compactReference(reference: ImageGenReference): ImageGenReference | null {
  const plain = plainReference(reference)
  if (!plain) return null
  return {
    id: plain.id,
    title: plain.title,
    ...(plain.storagePath ? { storagePath: plain.storagePath } : {}),
    ...(plain.previewUrl ? { previewUrl: plain.previewUrl } : {}),
    ...(plain.previewPath ? { previewPath: plain.previewPath } : {}),
    ...(plain.thumbnailUrl ? { thumbnailUrl: plain.thumbnailUrl } : {}),
    ...(plain.thumbnailPath ? { thumbnailPath: plain.thumbnailPath } : {}),
    ...(plain.content ? { content: plain.content } : {}),
    ...(plain.fileName ? { fileName: plain.fileName } : {}),
    ...(!plain.storagePath && plain.dataUrl ? { dataUrl: plain.dataUrl } : {}),
  }
}

async function uploadReference(
  reference: ImageGenReference,
  token: string | null,
  signal: AbortSignal,
) {
  const compact = compactReference(reference)
  if (!compact) return null
  if (compact.storagePath) return compact

  const blob = await referenceDataToBlob(reference)
  if (!blob) {
    throw new Error('参考图读取失败，请重新选择图片。')
  }

  const headers: Record<string, string> = {
    'Content-Type': blob.type || 'image/webp',
  }
  const id = encodedHeader(compact.id)
  const title = encodedHeader(compact.title)
  const fileName = encodedHeader(compact.fileName)
  if (token) headers.Authorization = `Bearer ${token}`
  if (id) headers['x-reference-id'] = id
  if (title) headers['x-reference-title'] = title
  if (fileName) headers['x-reference-filename'] = fileName

  const response = await fetch(imageApiUrl('/api/image/references'), {
    method: 'POST',
    headers,
    body: blob,
    signal,
  })
  if (!response.ok) {
    throw new Error(await readApiError(response, '参考图上传失败，请稍后重试。'))
  }

  const data = await response.json() as { reference?: ImageGenReference }
  const uploaded = data.reference ? plainReference(data.reference) : null
  if (!uploaded?.storagePath) {
    throw new Error('参考图上传失败，请稍后重试。')
  }

  return {
    ...uploaded,
    ...(compact.content ? { content: compact.content } : {}),
    ...(compact.fileName && !uploaded.fileName ? { fileName: compact.fileName } : {}),
  }
}

async function prepareGenerationReferences(
  references: ImageGenReference[] | undefined,
  token: string | null,
  signal: AbortSignal,
) {
  const compactReferences = Array.isArray(references)
    ? references
      .map(reference => compactReference(reference))
      .filter((reference): reference is ImageGenReference => Boolean(reference))
    : []

  if (!compactReferences.length) return []

  const uploaded = await Promise.all(compactReferences.map(reference => uploadReference(reference, token, signal)))
  return uploaded.filter((reference): reference is ImageGenReference => Boolean(reference))
}

function sortHistory(images: GeneratedImage[]) {
  return images
    .map(image => plainHistoryImage(image))
    .filter((item): item is GeneratedImage => Boolean(item))
    .sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''))
}

function uniqueHistory(images: GeneratedImage[], limit = MAX_HISTORY) {
  const seen = new Set<string>()
  return sortHistory(images).filter((image) => {
    if (seen.has(image.id)) return false
    seen.add(image.id)
    return true
  }).slice(0, limit)
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

type AuthIdentity = Awaited<ReturnType<typeof getAuthIdentity>>

const emptyRemoteHistory = { images: [], hasMore: false, nextOffset: null }

async function loadRemoteHistory(
  offset = 0,
  scope: ImageHistoryScope = 'public',
  identity?: AuthIdentity,
) {
  try {
    const auth = scope === 'mine'
      ? identity ?? await getAuthIdentity()
      : { accessToken: null, userId: null }
    if (scope === 'mine' && !auth.accessToken) return emptyRemoteHistory

    const query = new URLSearchParams({
      limit: String(HISTORY_PAGE_SIZE),
      offset: String(offset),
      scope,
    })
    const res = await fetch(imageApiUrl(`/api/image/history?${query.toString()}`), {
      cache: 'no-store',
      headers: scope === 'mine' && auth.accessToken
        ? { Authorization: `Bearer ${auth.accessToken}` }
        : undefined,
    })
    if (!res.ok) return emptyRemoteHistory
    const data = await res.json() as ImageHistoryResponse
    return {
      images: uniqueHistory(data.images || [], scope === 'public' ? MAX_GALLERY_HISTORY : MAX_HISTORY),
      hasMore: Boolean(data.hasMore),
      nextOffset: typeof data.nextOffset === 'number' ? data.nextOffset : null,
    }
  } catch (err) {
    console.warn('[image-history] Supabase history load failed', err)
    return emptyRemoteHistory
  }
}

async function loadRemoteImageDetail(
  id: string,
  scope: ImageHistoryScope = 'mine',
  options: ResolveImageDetailOptions = {},
) {
  try {
    const auth = scope === 'mine'
      ? await getAuthIdentity()
      : { accessToken: null, userId: null }
    if (scope === 'mine' && !auth.accessToken) return null

    const query = new URLSearchParams({ scope })
    if (options.includeOriginal) {
      query.set('original', '1')
    }
    const res = await fetch(imageApiUrl(`/api/image/history/${encodeURIComponent(id)}?${query.toString()}`), {
      cache: 'no-store',
      headers: scope === 'mine' && auth.accessToken
        ? { Authorization: `Bearer ${auth.accessToken}` }
        : undefined,
    })
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
    const token = await getAuthAccessToken()
    if (!token) return

    await fetch(imageApiUrl(`/api/image/history/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    console.warn('[image-history] Supabase history delete failed', err)
  }
}

export function useImageGen() {
  const { user } = useAuthSession()
  const { setCreditBalance } = useCredits()
  const isGenerating = ref(false)
  const isLoadingHistory = ref(false)
  const hasMoreHistory = ref(false)
  const nextHistoryOffset = ref<number | null>(null)
  const isLoadingGallery = ref(false)
  const hasMoreGallery = ref(false)
  const nextGalleryOffset = ref<number | null>(null)
  const galleryLoaded = ref(false)
  const error = ref<string | null>(null)
  const generatedImages = ref<GeneratedImage[]>(loadLegacyHistory())
  const galleryImages = ref<GeneratedImage[]>([])
  let historyLoadSeq = 0

  async function refreshPrivateHistory() {
    const seq = ++historyLoadSeq
    isLoadingHistory.value = true
    try {
      const identity = await getAuthIdentity()
      const localHistory = identity.userId ? [] : await loadPersistedHistory()
      const remoteHistory = await loadRemoteHistory(0, 'mine', identity)
      if (seq !== historyLoadSeq) return

      generatedImages.value = uniqueHistory([...localHistory, ...remoteHistory.images])
      hasMoreHistory.value = remoteHistory.hasMore
      nextHistoryOffset.value = remoteHistory.nextOffset
      if (!identity.userId) {
        void saveHistory(generatedImages.value)
      }
    } finally {
      if (seq === historyLoadSeq) {
        isLoadingHistory.value = false
      }
    }
  }

  watch(
    () => user.value?.id || null,
    () => {
      void refreshPrivateHistory()
    },
    { immediate: true },
  )

  async function generate(prompt: string, options: ImageGenOptions = {}): Promise<GeneratedImage[] | null> {
    error.value = null
    isGenerating.value = true

    if (!user.value?.id) {
      const appCfg = await ensureAppConfig()
      if (!appCfg.guestGenerationEnabled) {
        error.value = '请先登录后再生成图片'
        isGenerating.value = false
        return null
      }
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)
    const requestStartedAt = Date.now()
    const expectedPrompt = normalizedPrompt(options.userPrompt || options.displayPrompt || prompt)
    const expectedCount = Math.max(1, Number(options.count || 1))
    let requestReferences: ImageGenReference[] = []

    try {
      const token = await getAuthAccessToken()
      requestReferences = await prepareGenerationReferences(options.references, token, controller.signal)
      const requestOptions: ImageGenOptions = {
        ...options,
        references: requestReferences,
      }
      const res = await fetch(imageApiUrl('/api/image/generate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, ...requestOptions }),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(await readApiError(res, '图片生成失败，请稍后重试。'))
      }

      const data: ImageGenResponse = await res.json()
      if (typeof data.creditBalance?.balance === 'number') {
        setCreditBalance(data.creditBalance.balance)
      }
      const images = (data.images || [])
        .filter(image => image?.dataUrl || image?.previewUrl || image?.thumbnailUrl)
      if (!images.length) {
        throw new Error('no image returned')
      }

      const imagesWithReferences: GeneratedImage[] = images.map(image => ({
        ...image,
        references: image.references?.length
          ? image.references.map(reference => ({ ...reference }))
          : requestReferences.map(reference => ({ ...reference })),
      }))

      generatedImages.value = uniqueHistory([...imagesWithReferences, ...generatedImages.value])
      if (user.value?.id) {
        hasMoreHistory.value = true
      } else {
        void saveHistory(generatedImages.value)
      }
      if (galleryLoaded.value) {
        const publicImages = imagesWithReferences.filter(isPublicGalleryImage)
        if (publicImages.length) {
          galleryImages.value = uniqueHistory([...publicImages, ...galleryImages.value], MAX_GALLERY_HISTORY)
        }
      }
      return imagesWithReferences
    } catch (err: any) {
      if (isRecoverableGenerationError(err)) {
        const identity = await getAuthIdentity()
        const scope: ImageHistoryScope = identity.userId ? 'mine' : 'public'
        const recoveredHistory = await loadRemoteHistory(0, scope, identity)
        const recoveredImages = recoveredHistory.images
          .filter(image => historyMatchesRequest(image, expectedPrompt, requestStartedAt))
          .slice(0, expectedCount)

        if (recoveredImages.length) {
          const imagesWithReferences: GeneratedImage[] = recoveredImages.map(image => ({
            ...image,
            references: image.references?.length
              ? image.references.map(reference => ({ ...reference }))
              : requestReferences.map(reference => ({ ...reference })),
          }))
          generatedImages.value = uniqueHistory([...imagesWithReferences, ...generatedImages.value])
          if (!identity.userId) {
            void saveHistory(generatedImages.value)
          } else {
            hasMoreHistory.value = true
          }
          if (galleryLoaded.value) {
            const publicImages = imagesWithReferences.filter(isPublicGalleryImage)
            if (publicImages.length) {
              galleryImages.value = uniqueHistory([...publicImages, ...galleryImages.value], MAX_GALLERY_HISTORY)
            }
          }
          error.value = null
          return imagesWithReferences
        }
        console.debug('[image] generation recovery found no matching history', {
          userId: identity.userId || null,
          scope,
          expectedPrompt,
          expectedCount,
          requestStartedAt,
          error: err instanceof Error ? err.message : String(err || ''),
        })
      }
      error.value = err?.name === 'AbortError'
        ? '图片生成请求超时，请减少参考图数量或稍后重试。'
        : /ERR_CONNECTION_CLOSED|socket hang up|ECONNRESET|Failed to fetch|NetworkError/i.test(err?.message || '')
        ? '服务器连接被中断，可能是参考图下载超时或平台限制。请减少参考图数量或稍后重试。'
        : publicClientErrorMessage(err, '图片生成失败，请稍后重试。')
      return null
    } finally {
      window.clearTimeout(timeoutId)
      isGenerating.value = false
    }
  }

  function removeImage(id: string) {
    generatedImages.value = generatedImages.value.filter(img => img.id !== id)
    if (!user.value?.id) {
      void saveHistory(generatedImages.value)
    }
    void deleteRemoteHistory(id)
  }

  function clearHistory() {
    return
  }

  async function resolveImageDetail(
    image: GeneratedImage,
    scope: ImageHistoryScope = 'mine',
    options: ResolveImageDetailOptions = {},
  ) {
    const hasRequestedImage = options.includeOriginal ? Boolean(image.dataUrl) : Boolean(image.previewUrl)
    if (hasRequestedImage && (!options.requireStoragePath || image.storagePath)) return image

    const detail = await loadRemoteImageDetail(image.id, scope, options)
    if (!detail) return image

    if (scope === 'public') {
      galleryImages.value = uniqueHistory([detail, ...galleryImages.value], MAX_GALLERY_HISTORY)
    } else {
      generatedImages.value = uniqueHistory([detail, ...generatedImages.value])
      if (!user.value?.id) {
        void saveHistory(generatedImages.value)
      }
    }
    return detail
  }

  async function loadMoreHistory() {
    if (isLoadingHistory.value || !hasMoreHistory.value || nextHistoryOffset.value === null) return
    isLoadingHistory.value = true
    try {
      const remoteHistory = await loadRemoteHistory(nextHistoryOffset.value, 'mine')
      generatedImages.value = uniqueHistory([...generatedImages.value, ...remoteHistory.images])
      hasMoreHistory.value = remoteHistory.hasMore
      nextHistoryOffset.value = remoteHistory.nextOffset
      if (!user.value?.id) {
        void saveHistory(generatedImages.value)
      }
    } finally {
      isLoadingHistory.value = false
    }
  }

  async function ensureGalleryLoaded() {
    if (galleryLoaded.value || isLoadingGallery.value) return
    isLoadingGallery.value = true
    try {
      const remoteHistory = await loadRemoteHistory(0, 'public')
      galleryImages.value = uniqueHistory(remoteHistory.images, MAX_GALLERY_HISTORY)
      hasMoreGallery.value = remoteHistory.hasMore
      nextGalleryOffset.value = remoteHistory.nextOffset
      galleryLoaded.value = true
    } finally {
      isLoadingGallery.value = false
    }
  }

  async function loadMoreGalleryHistory() {
    if (isLoadingGallery.value || !hasMoreGallery.value || nextGalleryOffset.value === null) return
    isLoadingGallery.value = true
    try {
      const remoteHistory = await loadRemoteHistory(nextGalleryOffset.value, 'public')
      galleryImages.value = uniqueHistory([...galleryImages.value, ...remoteHistory.images], MAX_GALLERY_HISTORY)
      hasMoreGallery.value = remoteHistory.hasMore
      nextGalleryOffset.value = remoteHistory.nextOffset
      galleryLoaded.value = true
    } finally {
      isLoadingGallery.value = false
    }
  }

  return {
    isGenerating,
    isLoadingHistory,
    hasMoreHistory,
    isLoadingGallery,
    hasMoreGallery,
    galleryLoaded,
    error,
    generatedImages,
    galleryImages,
    generate,
    removeImage,
    clearHistory,
    loadMoreHistory,
    ensureGalleryLoaded,
    loadMoreGalleryHistory,
    resolveImageDetail,
  }
}
