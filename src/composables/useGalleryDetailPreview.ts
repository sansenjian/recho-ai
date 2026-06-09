import { ref } from 'vue'
import { galleryFileName, galleryPrompt, previewImageUrl } from '../lib/image-gallery'
import { preloadImageUrl } from '../lib/image-canvas-utils'
import type { ImageViewerState } from '../lib/image-canvas-model'
import type { GeneratedImage } from '../types/image'
import type { ImageHistoryScope } from './useImageGen'

export interface UseGalleryDetailPreviewOptions {
  currentScope: () => ImageHistoryScope
  resolveImageDetail: (image: GeneratedImage, scope?: ImageHistoryScope) => Promise<GeneratedImage>
  setError: (message: string) => void
}

function immediateGalleryDetailImageUrl(image: GeneratedImage) {
  return image.previewUrl || image.thumbnailUrl || image.dataUrl || ''
}

function viewerTitle(image: GeneratedImage) {
  return galleryFileName(image).replace(/\.[a-z0-9]{2,5}$/i, '')
}

export function useGalleryDetailPreview(options: UseGalleryDetailPreviewOptions) {
  const galleryDetail = ref<GeneratedImage | null>(null)
  const galleryDetailScope = ref<ImageHistoryScope>('mine')
  const galleryDetailDisplayUrl = ref('')
  const isGalleryDetailLoadingPreview = ref(false)
  let galleryDetailLoadSeq = 0

  function galleryDetailImageUrl(image: GeneratedImage) {
    return galleryDetail.value?.id === image.id
      ? galleryDetailDisplayUrl.value || previewImageUrl(image)
      : previewImageUrl(image)
  }

  function closeGalleryDetail() {
    galleryDetailLoadSeq += 1
    galleryDetail.value = null
    galleryDetailScope.value = 'mine'
    galleryDetailDisplayUrl.value = ''
    isGalleryDetailLoadingPreview.value = false
  }

  async function loadGalleryDetailPreview(image: GeneratedImage, seq: number) {
    const previewUrl = image.previewUrl || ''
    const fallbackUrl = immediateGalleryDetailImageUrl(image)

    if (!previewUrl) {
      galleryDetailDisplayUrl.value = fallbackUrl
      isGalleryDetailLoadingPreview.value = false
      return
    }

    if (!galleryDetailDisplayUrl.value) {
      galleryDetailDisplayUrl.value = fallbackUrl || previewUrl
    }

    if (galleryDetailDisplayUrl.value === previewUrl) {
      isGalleryDetailLoadingPreview.value = false
      return
    }

    isGalleryDetailLoadingPreview.value = true
    try {
      await preloadImageUrl(previewUrl)
      if (seq !== galleryDetailLoadSeq) return
      galleryDetailDisplayUrl.value = previewUrl
    } catch {
      if (seq === galleryDetailLoadSeq && fallbackUrl) {
        galleryDetailDisplayUrl.value = fallbackUrl
      }
    } finally {
      if (seq === galleryDetailLoadSeq) {
        isGalleryDetailLoadingPreview.value = false
      }
    }
  }

  async function openGalleryDetail(image: GeneratedImage) {
    const scope = options.currentScope()
    const seq = ++galleryDetailLoadSeq
    galleryDetailScope.value = scope

    const immediateUrl = immediateGalleryDetailImageUrl(image)
    if (immediateUrl) {
      galleryDetail.value = image
      galleryDetailDisplayUrl.value = immediateUrl
      isGalleryDetailLoadingPreview.value = Boolean(!image.previewUrl)
    }

    const detail = image.previewUrl ? image : await options.resolveImageDetail(image, scope)
    if (seq !== galleryDetailLoadSeq) return

    if (!previewImageUrl(detail) && !immediateUrl) {
      options.setError('图片加载失败，请稍后重试。')
      return
    }

    galleryDetail.value = detail
    await loadGalleryDetailPreview(detail, seq)
  }

  function createViewerState(): ImageViewerState | null {
    if (!galleryDetail.value) return null
    const imageUrl = galleryDetailImageUrl(galleryDetail.value)
    if (!imageUrl) {
      options.setError('预览图加载失败，请稍后重试。')
      return null
    }

    const sourceImage = galleryDetail.value
    return {
      imageUrl,
      title: viewerTitle(sourceImage),
      caption: galleryPrompt(sourceImage),
      zoom: 1,
      loadingPreview: !sourceImage.previewUrl,
      sourceImageId: sourceImage.id,
      sourceScope: galleryDetailScope.value,
    }
  }

  async function resolveViewerPreview(seq: number, currentSeq: () => number, update: (image: GeneratedImage, imageUrl: string) => void) {
    const sourceImage = galleryDetail.value
    if (!sourceImage || sourceImage.previewUrl) return

    try {
      const image = await options.resolveImageDetail(sourceImage, galleryDetailScope.value)
      const imageUrl = previewImageUrl(image)
      if (!imageUrl || seq !== currentSeq()) return
      galleryDetail.value = image
      update(image, imageUrl)
    } catch {
      // The caller owns viewer loading state; failed preview upgrade keeps the immediate image visible.
    }
  }

  return {
    galleryDetail,
    galleryDetailScope,
    galleryDetailDisplayUrl,
    isGalleryDetailLoadingPreview,
    galleryDetailImageUrl,
    closeGalleryDetail,
    openGalleryDetail,
    createViewerState,
    resolveViewerPreview,
  }
}
