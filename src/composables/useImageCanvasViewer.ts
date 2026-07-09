import { ref } from 'vue'
import type { CanvasNode, ImageViewerState } from '../lib/image-canvas-model'
import { clamp } from '../lib/image-canvas-utils'
import { hasImageSource, imageSourceUrl } from '../lib/authenticated-image-source'
import { galleryFileName, galleryPrompt, previewImageUrl } from '../lib/image-gallery'
import type { GeneratedImage } from '../types/image'

export interface UseImageCanvasViewerOptions {
  historyImageForNode: (node: CanvasNode) => GeneratedImage | null
  resolveNodePreviewImageUrl: (node: CanvasNode) => Promise<string>
  createGalleryDetailViewerState: () => ImageViewerState | null
  resolveGalleryDetailViewerPreview: (
    seq: number,
    currentSeq: () => number,
    update: (image: GeneratedImage, imageUrl: string) => void,
  ) => Promise<void>
}

function imageAltText(node: CanvasNode) {
  return node.content.trim() || node.sourcePrompt || node.title
}

export function useImageCanvasViewer(options: UseImageCanvasViewerOptions) {
  const imageViewer = ref<ImageViewerState | null>(null)
  let imageViewerLoadSeq = 0

  async function openGalleryDetailViewer() {
    const seq = ++imageViewerLoadSeq
    imageViewer.value = options.createGalleryDetailViewerState()
    if (!imageViewer.value) return

    void options.resolveGalleryDetailViewerPreview(seq, () => imageViewerLoadSeq, (image, imageUrl) => {
      if (!imageViewer.value) return
      imageViewer.value = {
        ...imageViewer.value,
        imageUrl,
        ...(image.storagePath ? { storagePath: image.storagePath } : {}),
        ...(image.previewPath ? { previewPath: image.previewPath } : {}),
        ...(image.thumbnailPath ? { thumbnailPath: image.thumbnailPath } : {}),
        title: galleryFileName(image).replace(/\.[a-z0-9]{2,5}$/i, ''),
        caption: galleryPrompt(image),
        loadingPreview: false,
      }
    }).finally(() => {
      if (seq === imageViewerLoadSeq && imageViewer.value) {
        imageViewer.value = { ...imageViewer.value, loadingPreview: false }
      }
    })
  }

  async function openImageViewer(node: CanvasNode) {
    if (!hasImageSource(node, 'preview')) return
    const seq = ++imageViewerLoadSeq
    const sourceNode = { ...node }
    const historyImage = options.historyImageForNode(sourceNode)
    const immediateUrl = historyImage
      ? previewImageUrl(historyImage) || imageSourceUrl(sourceNode, 'preview')
      : imageSourceUrl(sourceNode, 'preview')
    imageViewer.value = {
      imageUrl: immediateUrl,
      ...(historyImage?.storagePath || node.storagePath ? { storagePath: historyImage?.storagePath || node.storagePath } : {}),
      ...(historyImage?.previewPath ? { previewPath: historyImage.previewPath } : {}),
      ...(historyImage?.thumbnailPath ? { thumbnailPath: historyImage.thumbnailPath } : {}),
      title: node.title,
      caption: imageAltText(node),
      zoom: 1,
      loadingPreview: Boolean(node.sourceImageId && !historyImage?.previewUrl),
      sourceImageId: node.sourceImageId,
      sourceScope: node.sourceHistoryScope,
    }

    if (node.sourceImageId && !historyImage?.previewUrl) {
      void options.resolveNodePreviewImageUrl(sourceNode).then((imageUrl) => {
        if (!imageUrl || seq !== imageViewerLoadSeq || !imageViewer.value) return

        imageViewer.value = {
          ...imageViewer.value,
          imageUrl,
          ...(historyImage?.storagePath ? { storagePath: historyImage.storagePath } : {}),
          ...(historyImage?.previewPath ? { previewPath: historyImage.previewPath } : {}),
          ...(historyImage?.thumbnailPath ? { thumbnailPath: historyImage.thumbnailPath } : {}),
          loadingPreview: false,
        }
      }).catch(() => {
        if (seq === imageViewerLoadSeq && imageViewer.value) {
          imageViewer.value = { ...imageViewer.value, loadingPreview: false }
        }
      })
    }
  }

  function closeImageViewer() {
    imageViewerLoadSeq += 1
    imageViewer.value = null
  }

  function zoomImageViewer(step: number) {
    if (!imageViewer.value) return
    imageViewer.value.zoom = clamp(imageViewer.value.zoom + step, 0.35, 4)
  }

  function resetImageViewerZoom() {
    if (!imageViewer.value) return
    imageViewer.value.zoom = 1
  }

  return {
    imageViewer,
    openGalleryDetailViewer,
    openImageViewer,
    closeImageViewer,
    zoomImageViewer,
    resetImageViewerZoom,
  }
}
