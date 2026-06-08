const PNG_MIME_TYPE = 'image/png'
const PNG_EXTENSION = 'png'
const DEFAULT_OBJECT_URL_REVOKE_DELAY_MS = 5 * 60_000
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000
const DEFAULT_CONVERSION_TIMEOUT_MS = 120_000
const WORKER_IDLE_TIMEOUT_MS = 60_000
const DEFAULT_DOWNLOAD_CACHE_TTL_MS = 2 * 60_000
const MAX_CACHED_DOWNLOADS = 6

type ImageDownloadWorkerResponse =
  | { id: string; type: 'result'; blob: Blob }
  | { id: string; type: 'error'; error: string }

type PendingWorkerRequest = {
  resolve: (blob: Blob) => void
  reject: (error: Error | DOMException) => void
  timeoutId: number
}

export interface DownloadImageOptions {
  imageUrl: string
  title: string
  revokeDelayMs?: number
  timeoutMs?: number
  conversionTimeoutMs?: number
}

type PreparedDownload = {
  pngBlob: Blob
  expiresAt: number
  lastUsedAt: number
}

const pendingWorkerRequests = new Map<string, PendingWorkerRequest>()
const preparedDownloads = new Map<string, Promise<PreparedDownload>>()
let conversionWorker: Worker | null = null
let workerIdleTimeoutId = 0

export function safeImageDownloadFileName(title: string) {
  const withoutExtension = title.replace(/\.([a-z0-9]{2,5})$/i, '')
  const safeBaseName = withoutExtension
    .slice(0, 60)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[^a-zA-Z0-9一-\u9fa5._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .trim()

  return `${safeBaseName || 'recho_image'}.${PNG_EXTENSION}`
}

function timeoutError(label: string, timeoutMs: number) {
  return new DOMException(`${label} timed out after ${timeoutMs}ms`, 'AbortError')
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function abortSignalWithTimeout(timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => {
    controller.abort(timeoutError('Image download', timeoutMs))
  }, timeoutMs)

  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId),
  }
}

function triggerBrowserDownload(href: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

async function fetchImageBlob(imageUrl: string, timeoutMs: number) {
  const timeout = abortSignalWithTimeout(timeoutMs)
  try {
    const response = await fetch(imageUrl, {
      cache: 'force-cache',
      signal: timeout.signal,
    })
    if (!response.ok) throw new Error(`Image download failed with ${response.status}`)

    const blob = await response.blob()
    if (!blob.size) throw new Error('Image download returned an empty file')
    return blob
  } finally {
    timeout.clear()
  }
}

function downloadCacheKey(imageUrl: string) {
  return imageUrl
}

function clearExpiredPreparedDownloads(now = Date.now()) {
  for (const [key, prepared] of preparedDownloads) {
    void prepared.then((value) => {
      if (value.expiresAt <= now) preparedDownloads.delete(key)
    }).catch(() => {
      preparedDownloads.delete(key)
    })
  }
}

function trimPreparedDownloadCache() {
  if (preparedDownloads.size <= MAX_CACHED_DOWNLOADS) return

  const entries = [...preparedDownloads.entries()]
  void Promise.allSettled(entries.map(([, prepared]) => prepared)).then((settled) => {
    const resolved = settled
      .map((result, index) => ({
        key: entries[index]?.[0] || '',
        value: result.status === 'fulfilled' ? result.value : null,
      }))
      .filter((entry): entry is { key: string; value: PreparedDownload } => Boolean(entry.key && entry.value))
      .sort((a, b) => a.value.lastUsedAt - b.value.lastUsedAt)

    for (const entry of resolved.slice(0, Math.max(0, preparedDownloads.size - MAX_CACHED_DOWNLOADS))) {
      preparedDownloads.delete(entry.key)
    }
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob?.size) {
        reject(new Error('PNG export returned an empty file'))
        return
      }
      resolve(blob)
    }, PNG_MIME_TYPE)
  })
}

async function imageBlobToPngBlobOnMainThread(blob: Blob) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')

  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob)
    try {
      if (!bitmap.width || !bitmap.height) throw new Error('Image has invalid dimensions')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      context.drawImage(bitmap, 0, 0)
    } finally {
      bitmap.close()
    }
    return await canvasToPngBlob(canvas)
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Image decode failed'))
      element.src = objectUrl
    })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image has invalid dimensions')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    context.drawImage(image, 0, 0)
    return await canvasToPngBlob(canvas)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function rejectPendingWorkerRequests(error: Error | DOMException) {
  for (const pending of pendingWorkerRequests.values()) {
    window.clearTimeout(pending.timeoutId)
    pending.reject(error)
  }
  pendingWorkerRequests.clear()
}

function terminateConversionWorker() {
  if (workerIdleTimeoutId) {
    window.clearTimeout(workerIdleTimeoutId)
    workerIdleTimeoutId = 0
  }
  conversionWorker?.terminate()
  conversionWorker = null
}

function scheduleWorkerIdleCleanup() {
  if (pendingWorkerRequests.size) return
  if (workerIdleTimeoutId) window.clearTimeout(workerIdleTimeoutId)
  workerIdleTimeoutId = window.setTimeout(() => {
    terminateConversionWorker()
  }, WORKER_IDLE_TIMEOUT_MS)
}

function getConversionWorker() {
  if (conversionWorker) {
    if (workerIdleTimeoutId) {
      window.clearTimeout(workerIdleTimeoutId)
      workerIdleTimeoutId = 0
    }
    return conversionWorker
  }

  conversionWorker = new Worker(new URL('../workers/image-download.worker.ts', import.meta.url), {
    type: 'module',
  })

  conversionWorker.onmessage = (event: MessageEvent<ImageDownloadWorkerResponse>) => {
    const message = event.data
    const pending = pendingWorkerRequests.get(message.id)
    if (!pending) return

    window.clearTimeout(pending.timeoutId)
    pendingWorkerRequests.delete(message.id)

    if (message.type === 'result') {
      pending.resolve(message.blob)
    } else {
      pending.reject(new Error(message.error || 'PNG export failed'))
    }
    scheduleWorkerIdleCleanup()
  }

  conversionWorker.onerror = (event) => {
    const error = new Error(event.message || 'PNG export worker failed')
    rejectPendingWorkerRequests(error)
    terminateConversionWorker()
  }

  return conversionWorker
}

function convertImageBlobInWorker(blob: Blob, timeoutMs: number) {
  return new Promise<Blob>((resolve, reject) => {
    const worker = getConversionWorker()
    const requestId = crypto.randomUUID()
    const timeoutId = window.setTimeout(() => {
      pendingWorkerRequests.delete(requestId)
      rejectPendingWorkerRequests(timeoutError('PNG conversion', timeoutMs))
      terminateConversionWorker()
      reject(timeoutError('PNG conversion', timeoutMs))
    }, timeoutMs)

    pendingWorkerRequests.set(requestId, { resolve, reject, timeoutId })
    worker.postMessage({ id: requestId, blob })
  })
}

async function withConversionTimeout<T>(task: Promise<T>, timeoutMs: number) {
  let timeoutId = 0
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(timeoutError('PNG conversion', timeoutMs)), timeoutMs)
  })

  try {
    return await Promise.race([task, timeout])
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function imageBlobToPngBlob(blob: Blob, timeoutMs: number) {
  if ('Worker' in window && 'OffscreenCanvas' in window && 'createImageBitmap' in window) {
    try {
      return await convertImageBlobInWorker(blob, timeoutMs)
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[image-download] worker conversion failed, falling back to main thread:', error)
    }
  }

  return await withConversionTimeout(imageBlobToPngBlobOnMainThread(blob), timeoutMs)
}

async function prepareImageDownload(options: DownloadImageOptions) {
  const {
    imageUrl,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
    conversionTimeoutMs = DEFAULT_CONVERSION_TIMEOUT_MS,
  } = options
  const now = Date.now()
  clearExpiredPreparedDownloads(now)

  const key = downloadCacheKey(imageUrl)
  const cached = preparedDownloads.get(key)
  if (cached) {
    const prepared = await cached.then((prepared) => {
      if (prepared.expiresAt <= Date.now()) {
        preparedDownloads.delete(key)
        return null
      }
      prepared.lastUsedAt = Date.now()
      return prepared
    }).catch((error) => {
      preparedDownloads.delete(key)
      throw error
    })
    if (prepared) return prepared
  }

  const pending = (async (): Promise<PreparedDownload> => {
    const sourceBlob = await fetchImageBlob(imageUrl, timeoutMs)
    const pngBlob = await imageBlobToPngBlob(sourceBlob, conversionTimeoutMs)
    return {
      pngBlob,
      expiresAt: Date.now() + DEFAULT_DOWNLOAD_CACHE_TTL_MS,
      lastUsedAt: Date.now(),
    }
  })()

  preparedDownloads.set(key, pending)
  trimPreparedDownloadCache()
  try {
    return await pending
  } catch (error) {
    if (preparedDownloads.get(key) === pending) {
      preparedDownloads.delete(key)
    }
    throw error
  }
}

export function preloadImageDownload(options: DownloadImageOptions) {
  void prepareImageDownload(options).catch((error) => {
    console.warn('[image-download] preload failed:', error)
  })
}

export async function downloadImage(options: DownloadImageOptions) {
  const {
    title,
    revokeDelayMs = DEFAULT_OBJECT_URL_REVOKE_DELAY_MS,
  } = options
  const { pngBlob } = await prepareImageDownload(options)
  const objectUrl = URL.createObjectURL(pngBlob)
  try {
    triggerBrowserDownload(objectUrl, safeImageDownloadFileName(title))
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), revokeDelayMs)
  }
}
