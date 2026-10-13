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
import { compressImageDataUrl, loadImageElement, readBlobAsDataUrl, readImageFileAsDataUrl } from './image-file'

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

export async function readImageDimensions(src: string) {
  return naturalImageDimensions(await loadImageElement(src))
}

/**
 * 按画布的参考图上限压缩。上限与编码质量是画布自己的取舍，调用方不该关心，
 * 所以在这里绑定成具体数值，而不是让每个调用点各传一次。
 */
export function compressReferenceImageDataUrl(dataUrl: string) {
  return compressImageDataUrl(dataUrl, {
    maxEdge: REFERENCE_IMAGE_MAX_EDGE,
    quality: REFERENCE_IMAGE_WEBP_QUALITY,
  })
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

export function hasFileTransfer(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes('Files') || Array.from(event.dataTransfer?.items ?? []).some(item => item.kind === 'file')
}

export { loadImageElement, readBlobAsDataUrl, readImageFileAsDataUrl }
