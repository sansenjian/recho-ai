/// <reference lib="webworker" />

const PNG_MIME_TYPE = 'image/png'

type WorkerRequest = {
  id: string
  blob: Blob
}

type WorkerResponse =
  | { id: string; type: 'result'; blob: Blob }
  | { id: string; type: 'error'; error: string }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'PNG export failed')
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, blob } = event.data

  try {
    if (!('createImageBitmap' in self) || !('OffscreenCanvas' in self)) {
      throw new Error('Worker image conversion is unavailable')
    }

    const bitmap = await createImageBitmap(blob)
    try {
      if (!bitmap.width || !bitmap.height) throw new Error('Image has invalid dimensions')

      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('OffscreenCanvas 2D context is unavailable')

      context.drawImage(bitmap, 0, 0)
      const pngBlob = await canvas.convertToBlob({ type: PNG_MIME_TYPE })
      if (!pngBlob.size) throw new Error('PNG export returned an empty file')

      self.postMessage({ id, type: 'result', blob: pngBlob } satisfies WorkerResponse)
    } finally {
      bitmap.close()
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', error: errorMessage(error) } satisfies WorkerResponse)
  }
}
