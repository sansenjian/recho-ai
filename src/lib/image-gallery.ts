import type {
  GeneratedImage,
  ImageAspectRatio,
  ImageQuality,
  ImageResolution,
} from '../types/image'
import type { GalleryParam, GalleryReference } from './image-canvas-model'
import { hasImageSource, imageSourceUrl } from './authenticated-image-source'

export interface GalleryOption<T extends string> {
  value: T
  label: string
}

export interface GalleryParamOptions {
  aspectRatioOptions: Array<GalleryOption<ImageAspectRatio>>
  resolutionOptions: Array<GalleryOption<ImageResolution>>
  qualityOptions: Array<GalleryOption<ImageQuality>>
}

export function isGallerySystemPromptBlock(block: string) {
  return (
    /^已上传 \d+ 张真实参考图/.test(block) &&
    block.includes('不要只根据文字重新想象')
  ) || /^.+: 第 \d+ 张参考图/.test(block)
}

export function galleryUserPrompt(image: GeneratedImage) {
  return image.userPrompt || image.prompt
}

export function galleryPrompt(image: GeneratedImage) {
  const prompt = galleryUserPrompt(image)?.trim()
  if (!prompt) return '无提示词'

  const visibleBlocks = prompt
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .filter(block => !isGallerySystemPromptBlock(block))

  return visibleBlocks.join('\n\n') || '无提示词'
}

export function galleryReferences(image: GeneratedImage) {
  return image.references?.filter(reference => reference.dataUrl || reference.storagePath || reference.previewUrl || reference.thumbnailUrl) ?? []
}

export function galleryReferenceCount(image: GeneratedImage) {
  return typeof image.referenceImageCount === 'number'
    ? image.referenceImageCount
    : galleryReferences(image).length
}

export function displayImageUrl(image: GeneratedImage) {
  return imageSourceUrl(image, 'thumbnail')
}

export function previewImageUrl(image: GeneratedImage) {
  return imageSourceUrl(image, 'preview')
}

export function displayReferenceUrl(reference: GalleryReference) {
  return imageSourceUrl(reference, 'thumbnail')
}

export function hasDisplayImage(image: GeneratedImage | GalleryReference) {
  return hasImageSource(image, 'thumbnail')
}

export function formatGalleryDate(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
  })
}

export function galleryOptionLabel<T extends string>(
  value: T | undefined,
  options: Array<GalleryOption<T>>,
) {
  if (!value) return 'Auto'
  return options.find(option => option.value === value)?.label ?? value
}

export function galleryParamItems(image: GeneratedImage, options: GalleryParamOptions): GalleryParam[] {
  return [
    { label: '尺寸', value: image.size || 'auto' },
    { label: '比例', value: galleryOptionLabel(image.aspectRatio, options.aspectRatioOptions) },
    { label: '分辨率', value: galleryOptionLabel(image.resolution, options.resolutionOptions) },
    { label: '质量', value: galleryOptionLabel(image.quality, options.qualityOptions) },
  ]
}

export function galleryFileName(image: GeneratedImage) {
  const promptName = galleryPrompt(image)
    .slice(0, 28)
    .replace(/[^a-zA-Z0-9一-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
  return `${promptName || image.id || 'recho_image'}.webp`
}
