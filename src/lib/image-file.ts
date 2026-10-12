/**
 * 图片文件的读取与压缩。
 *
 * 这几件事此前散在两处：画布模块的 image-canvas-utils.ts 和 AppShell 里一份内联实现
 * （fileToBase64，约 35 行）。两边做的是同一件事——读成 dataURL、必要时压一下——
 * 但参数与返回形状不同，于是各写各的。
 *
 * 这里只放不认识业务的部分：读文件、加载图片、按给定上限压缩。压缩的上限由调用方
 * 传入，画布与生图各自的常量留在各自模块里，避免通用工具反过来依赖业务模块。
 */

/** 内联 dataURL 的前缀。非内联（http/blob）的地址不做压缩，直接返回。 */
const INLINE_DATA_URL_PREFIX = 'data:'

export function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('图片读取失败'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

export function readImageFileAsDataUrl(file: File) {
  return readBlobAsDataUrl(file)
}

export function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(blob => resolve(blob), type, quality)
  })
}

export function isInlineImageDataUrl(value: string) {
  return value.startsWith(INLINE_DATA_URL_PREFIX)
}

export interface CompressImageOptions {
  /** 长边上限，超出才缩放。 */
  maxEdge: number
  /** 0-1，WebP 编码质量。 */
  quality: number
}

/**
 * 按上限压缩内联 dataURL。
 *
 * 压不小就原样返回：缩过但体积反而变大（小图重编码）时保留原图更合适，调用方不必
 * 再判一次。加载或编码失败同样回退原值——这条路径不该让上传动作失败。
 */
export async function compressImageDataUrl(dataUrl: string, options: CompressImageOptions) {
  if (!isInlineImageDataUrl(dataUrl)) return dataUrl

  try {
    const image = await loadImageElement(dataUrl)
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    if (!sourceWidth || !sourceHeight) return dataUrl

    const scale = Math.min(1, options.maxEdge / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return dataUrl

    context.drawImage(image, 0, 0, width, height)
    const blob = await canvasToBlob(canvas, 'image/webp', options.quality)
    if (!blob) return dataUrl

    const compressed = await readBlobAsDataUrl(blob)
    return compressed.length < dataUrl.length || scale < 1 ? compressed : dataUrl
  } catch {
    return dataUrl
  }
}
