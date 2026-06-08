const PNG_MIME_TYPE = 'image/png'
const PNG_EXTENSION = 'png'
const DEFAULT_OBJECT_URL_REVOKE_DELAY_MS = 5 * 60_000
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000
const DEFAULT_CONVERSION_TIMEOUT_MS = 120_000

type ImageDownloadWorkerResponse =
  | { id: string; type: 'result'; blob: Blob }
  | { id: string; type: 'error'; error: string }

export interface DownloadImageOptions {
  imageUrl: string
  title: string
  revokeDelayMs?: number
  timeoutMs?: number
  conversionTimeoutMs?: number
}

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

function convertImageBlobInWorker(blob: Blob, timeoutMs: number) {
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/image-download.worker.ts', import.meta.url), {
      type: 'module',
    })
    const requestId = crypto.randomUUID()
    const timeoutId = window.setTimeout(() => {
      worker.terminate()
      reject(timeoutError('PNG conversion', timeoutMs))
    }, timeoutMs)

    worker.onmessage = (event: MessageEvent<ImageDownloadWorkerResponse>) => {
      const message = event.data
      if (message.id !== requestId) return

      window.clearTimeout(timeoutId)
      worker.terminate()

      if (message.type === 'result') {
        resolve(message.blob)
        return
      }
      reject(new Error(message.error || 'PNG export failed'))
    }

    worker.onerror = (event) => {
      window.clearTimeout(timeoutId)
      worker.terminate()
      reject(new Error(event.message || 'PNG export worker failed'))
    }

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

export async function downloadImage(options: DownloadImageOptions) {
  const {
    imageUrl,
    title,
    revokeDelayMs = DEFAULT_OBJECT_URL_REVOKE_DELAY_MS,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
    conversionTimeoutMs = DEFAULT_CONVERSION_TIMEOUT_MS,
  } = options
  const sourceBlob = await fetchImageBlob(imageUrl, timeoutMs)
  const pngBlob = await imageBlobToPngBlob(sourceBlob, conversionTimeoutMs)
  const objectUrl = URL.createObjectURL(pngBlob)
  try {
    triggerBrowserDownload(objectUrl, safeImageDownloadFileName(title))
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), revokeDelayMs)
  }
}
