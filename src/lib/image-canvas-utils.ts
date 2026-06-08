import {
  IMAGE_PREVIEW_EMPTY_HEIGHT,
  IMAGE_PREVIEW_HORIZONTAL_INSET,
  NODE_SIZE,
  REFERENCE_IMAGE_MAX_EDGE,
  REFERENCE_IMAGE_WEBP_QUALITY,
  type CanvasNode,
  type NodeDimensions,
} from './image-canvas-model'
import type { GeneratedImage } from '../types/image'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getNodeScale(node: CanvasNode) {
  return node.scale ?? 1
}

export function isGeneratedImageNode(node: CanvasNode) {
  return node.type === 'image' && Boolean(node.sourceImageId)
}

export function dimensionsFromSize(value?: string): NodeDimensions | null {
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(value || '')
  if (!match) return null

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}

export function dimensionsFromAspectRatio(value?: string): NodeDimensions | null {
  const match = /^([1-9]\d*):([1-9]\d*)$/.exec(value || '')
  if (!match) return null

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}

export function imageDimensionsFromHistory(image: GeneratedImage): Pick<CanvasNode, 'imageWidth' | 'imageHeight'> {
  const dimensions = dimensionsFromSize(image.size) ?? dimensionsFromAspectRatio(image.aspectRatio)
  return dimensions
    ? { imageWidth: dimensions.width, imageHeight: dimensions.height }
    : {}
}

export function imageAspectRatio(node: CanvasNode) {
  const dimensions = node.imageWidth && node.imageHeight
    ? { width: node.imageWidth, height: node.imageHeight }
    : dimensionsFromSize(node.fileName) ?? dimensionsFromAspectRatio(node.aspectRatio)
  if (!dimensions?.width || !dimensions.height) return 1

  const ratio = dimensions.width / dimensions.height
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

export function imagePreviewHeight(node: CanvasNode) {
  if (!node.imageUrl) return IMAGE_PREVIEW_EMPTY_HEIGHT

  const previewWidth = NODE_SIZE.image.width - IMAGE_PREVIEW_HORIZONTAL_INSET
  return Math.max(1, Math.round(previewWidth / imageAspectRatio(node)))
}

export function fallbackImageFileName(file: File) {
  if (file.name) return file.name
  const extension = file.type.split('/')[1] || 'png'
  return `剪贴板图片.${extension}`
}

export function isInlineImageDataUrl(value: string) {
  return /^data:image\//i.test(value)
}

export function naturalImageDimensions(image: HTMLImageElement): Pick<CanvasNode, 'imageWidth' | 'imageHeight'> {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  return width > 0 && height > 0
    ? { imageWidth: width, imageHeight: height }
    : {}
}

export function updateNodeImageDimensions(node: CanvasNode, image: HTMLImageElement) {
  const dimensions = naturalImageDimensions(image)
  if (!dimensions.imageWidth || !dimensions.imageHeight) return

  node.imageWidth = dimensions.imageWidth
  node.imageHeight = dimensions.imageHeight
}

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

export async function readImageDimensions(src: string) {
  return naturalImageDimensions(await loadImageElement(src))
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(blob => resolve(blob), type, quality)
  })
}

export async function compressReferenceImageDataUrl(dataUrl: string) {
  if (!isInlineImageDataUrl(dataUrl)) return dataUrl

  try {
    const image = await loadImageElement(dataUrl)
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    if (!sourceWidth || !sourceHeight) return dataUrl

    const scale = Math.min(1, REFERENCE_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return dataUrl

    context.drawImage(image, 0, 0, width, height)
    const blob = await canvasToBlob(canvas, 'image/webp', REFERENCE_IMAGE_WEBP_QUALITY)
    if (!blob) return dataUrl

    const compressed = await readBlobAsDataUrl(blob)
    return compressed.length < dataUrl.length || scale < 1 ? compressed : dataUrl
  } catch {
    return dataUrl
  }
}

export async function preloadImageUrl(src: string) {
  const image = await loadImageElement(src)
  await image.decode?.().catch(() => undefined)
}

export function clipboardImageFile(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? [])
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }

  return Array.from(event.clipboardData?.files ?? [])
    .find(file => file.type.startsWith('image/')) ?? null
}
