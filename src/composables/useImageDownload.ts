import { ref, type Ref } from 'vue'
import { downloadImage, preloadImageDownload } from '../lib/image-download'
import { originalImageDownloadUrl, originalStorageImageUrl } from '../lib/image-storage-url'
import type { GeneratedImage, ImageHistoryScope } from '../types/image'

export interface ImageDownloadNode {
  id: string
  title: string
  content: string
  imageUrl?: string
  storagePath?: string
  sourceImageId?: string
  sourceHistoryScope?: ImageHistoryScope
}

export interface ImageDownloadViewer {
  imageUrl: string
  title: string
  sourceImageId?: string
  sourceScope?: ImageHistoryScope
}

export interface DownloadTarget {
  key: string
  title: string
  directUrl?: string
  resolveUrl?: () => Promise<string>
}

interface UseImageDownloadOptions {
  resolveImageDetail: (
    image: GeneratedImage,
    scope?: ImageHistoryScope,
    options?: { includeOriginal?: boolean; requireStoragePath?: boolean },
  ) => Promise<GeneratedImage>
  imageFileName: (image: GeneratedImage) => string
  historyImageForNode: (node: ImageDownloadNode) => GeneratedImage | null
  historyImageForViewer: (viewer: ImageDownloadViewer) => GeneratedImage | null
  setError: (message: string) => void
}

function imageDownloadKey(image: GeneratedImage, scope: ImageHistoryScope = 'mine') {
  return `history:${scope}:${image.id}`
}

function nodeDownloadKey(node: ImageDownloadNode) {
  return node.sourceImageId
    ? `history:${node.sourceHistoryScope || 'mine'}:${node.sourceImageId}`
    : `node:${node.id}`
}

function viewerDownloadKey(viewer: ImageDownloadViewer | null) {
  if (!viewer) return ''
  return viewer.sourceImageId
    ? `history:${viewer.sourceScope || 'mine'}:${viewer.sourceImageId}`
    : `viewer:${viewer.imageUrl}`
}

export function useImageDownload(options: UseImageDownloadOptions) {
  const downloadingImages: Ref<Set<string>> = ref(new Set<string>())

  function isDownloadingImage(key: string) {
    return Boolean(key && downloadingImages.value.has(key))
  }

  function generatedImageTarget(image: GeneratedImage, scope: ImageHistoryScope = 'mine'): DownloadTarget {
    return {
      key: imageDownloadKey(image, scope),
      title: options.imageFileName(image),
      directUrl: originalImageDownloadUrl(image),
      resolveUrl: async () => {
        const detail = await options.resolveImageDetail(image, scope, { includeOriginal: true })
        return originalImageDownloadUrl(detail)
      },
    }
  }

  function nodeTarget(node: ImageDownloadNode): DownloadTarget {
    const historyImage = options.historyImageForNode(node)
    const directUrl = originalStorageImageUrl(node.storagePath, node.imageUrl) ||
      (historyImage ? originalImageDownloadUrl(historyImage) : '')

    return {
      key: nodeDownloadKey(node),
      title: node.content || node.title,
      directUrl,
      resolveUrl: async () => {
        if (!historyImage) return node.imageUrl || ''
        const detail = await options.resolveImageDetail(historyImage, node.sourceHistoryScope || 'mine', { includeOriginal: true })
        return originalImageDownloadUrl(detail) || node.imageUrl || ''
      },
    }
  }

  function viewerTarget(viewer: ImageDownloadViewer | null): DownloadTarget | null {
    if (!viewer) return null
    const sourceImage = options.historyImageForViewer(viewer)
    if (sourceImage) {
      return generatedImageTarget(sourceImage, viewer.sourceScope || 'mine')
    }

    return {
      key: viewerDownloadKey(viewer),
      title: viewer.title,
      directUrl: viewer.imageUrl,
    }
  }

  function preloadTarget(target: DownloadTarget | null) {
    if (!target?.directUrl) return
    preloadImageDownload({ imageUrl: target.directUrl, title: target.title })
  }

  async function withImageDownloadLock(key: string, task: () => Promise<void>) {
    if (!key || downloadingImages.value.has(key)) return
    const next = new Set(downloadingImages.value)
    next.add(key)
    downloadingImages.value = next

    try {
      await task()
    } finally {
      const updated = new Set(downloadingImages.value)
      updated.delete(key)
      downloadingImages.value = updated
    }
  }

  async function downloadTarget(target: DownloadTarget | null) {
    if (!target) return
    await withImageDownloadLock(target.key, async () => {
      const imageUrl = target.directUrl || await target.resolveUrl?.() || ''
      if (!imageUrl) {
        options.setError('原图加载失败，请稍后重试。')
        return
      }

      try {
        await downloadImage({
          imageUrl,
          title: target.title,
        })
      } catch (downloadError) {
        console.warn('Image download failed', downloadError)
        options.setError('图片下载失败，请稍后重试。')
      }
    })
  }

  return {
    imageDownloadKey,
    nodeDownloadKey,
    viewerDownloadKey,
    isDownloadingImage,
    generatedImageTarget,
    nodeTarget,
    viewerTarget,
    preloadTarget,
    downloadTarget,
  }
}
