import { compressReferenceImageDataUrl } from '../lib/image-canvas-utils'
import { previewImageUrl } from '../lib/image-gallery'
import type { CanvasNode } from '../lib/image-canvas-model'
import type { GeneratedImage, ImageGenReference } from '../types/image'
import type { ImageHistoryScope } from './useImageGen'

export interface UseImageNodeReferencesOptions {
  historyImageForNode: (node: CanvasNode) => GeneratedImage | null
  referencedImageNodes: (node: CanvasNode) => CanvasNode[]
  resolveImageDetail: (
    image: GeneratedImage,
    scope?: ImageHistoryScope,
    options?: { requireStoragePath?: boolean },
  ) => Promise<GeneratedImage>
}

export function useImageNodeReferences(options: UseImageNodeReferencesOptions) {
  async function resolveNodePreviewImageUrl(node: CanvasNode) {
    const historyImage = options.historyImageForNode(node)
    if (historyImage) {
      const detail = await options.resolveImageDetail(historyImage, node.sourceHistoryScope || 'mine')
      const imageUrl = previewImageUrl(detail)
      if (imageUrl) return imageUrl
    }

    return node.imageUrl || ''
  }

  async function resolveReferenceImageUrl(node: CanvasNode) {
    return await compressReferenceImageDataUrl(await resolveNodePreviewImageUrl(node))
  }

  async function storageReferenceForNode(node: CanvasNode) {
    if (node.storagePath) {
      return {
        storagePath: node.storagePath,
        ...(node.imageUrl ? { previewUrl: node.imageUrl } : {}),
      }
    }

    const historyImage = options.historyImageForNode(node)
    if (!historyImage) return null
    const detail = historyImage.storagePath
      ? historyImage
      : await options.resolveImageDetail(historyImage, node.sourceHistoryScope || 'mine', { requireStoragePath: true })
    if (!detail.storagePath) return null

    node.storagePath = detail.storagePath
    if (detail.previewUrl) node.imageUrl = detail.previewUrl

    return {
      storagePath: detail.storagePath,
      ...(detail.previewUrl ? { previewUrl: detail.previewUrl } : {}),
      ...(detail.previewPath ? { previewPath: detail.previewPath } : {}),
      ...(detail.thumbnailUrl ? { thumbnailUrl: detail.thumbnailUrl } : {}),
      ...(detail.thumbnailPath ? { thumbnailPath: detail.thumbnailPath } : {}),
    }
  }

  async function buildReferences(node: CanvasNode) {
    const imageNodes = options.referencedImageNodes(node)
      .filter((item): item is CanvasNode & { imageUrl: string } => Boolean(item.imageUrl))

    const references = await Promise.all(imageNodes.map(async (item): Promise<ImageGenReference> => {
      const storageReference = await storageReferenceForNode(item)
      return {
        id: item.id,
        title: item.title,
        ...(storageReference?.storagePath
          ? storageReference
          : { dataUrl: await resolveReferenceImageUrl(item) }),
        content: item.content.trim() || undefined,
        fileName: item.fileName,
      }
    }))

    return references.filter(reference => Boolean(reference.storagePath || reference.dataUrl))
  }

  return {
    buildReferences,
    resolveNodePreviewImageUrl,
  }
}
