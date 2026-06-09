import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageNodeReferences } from '../src/composables/useImageNodeReferences'
import type { CanvasNode } from '../src/lib/image-canvas-model'
import type { GeneratedImage } from '../src/types/image'

const canvasUtils = vi.hoisted(() => ({
  compressReferenceImageDataUrl: vi.fn(async (value: string) => `compressed:${value}`),
}))

vi.mock('../src/lib/image-canvas-utils', () => canvasUtils)

function imageNode(partial: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: partial.id || 'image_1',
    type: 'image',
    x: 0,
    y: 0,
    title: partial.title || '图片1',
    content: partial.content || '',
    size: 'auto',
    aspectRatio: 'auto',
    resolution: 'auto',
    quality: 'auto',
    imageUrl: partial.imageUrl,
    storagePath: partial.storagePath,
    sourceImageId: partial.sourceImageId,
    sourceHistoryScope: partial.sourceHistoryScope,
    fileName: partial.fileName,
  }
}

function historyImage(partial: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: partial.id || 'history_1',
    prompt: partial.prompt || 'prompt',
    dataUrl: partial.dataUrl,
    storagePath: partial.storagePath,
    previewUrl: partial.previewUrl,
    thumbnailUrl: partial.thumbnailUrl,
    size: partial.size || 'auto',
    aspectRatio: partial.aspectRatio,
    resolution: partial.resolution,
    quality: partial.quality,
    timestamp: partial.timestamp || '2026-06-09T00:00:00.000Z',
  }
}

describe('useImageNodeReferences', () => {
  beforeEach(() => {
    canvasUtils.compressReferenceImageDataUrl.mockClear()
  })

  it('builds references from existing storage paths without compressing image data', async () => {
    const node = imageNode({
      id: 'image_storage',
      title: '参考图',
      imageUrl: 'https://cdn.example.test/preview.webp',
      storagePath: 'generated/original.webp',
      content: 'reference note',
      fileName: 'original.webp',
    })
    const references = useImageNodeReferences({
      historyImageForNode: () => null,
      referencedImageNodes: () => [node],
      resolveImageDetail: vi.fn(),
    })

    await expect(references.buildReferences(imageNode({ id: 'generation_1', imageUrl: undefined })))
      .resolves.toEqual([{
        id: 'image_storage',
        title: '参考图',
        storagePath: 'generated/original.webp',
        previewUrl: 'https://cdn.example.test/preview.webp',
        content: 'reference note',
        fileName: 'original.webp',
      }])
    expect(canvasUtils.compressReferenceImageDataUrl).not.toHaveBeenCalled()
  })

  it('resolves history storage details before falling back to data urls', async () => {
    const node = imageNode({
      id: 'image_history',
      imageUrl: 'https://cdn.example.test/thumb.webp',
      sourceImageId: 'history_1',
    })
    const detail = historyImage({
      id: 'history_1',
      storagePath: 'generated/history.webp',
      previewUrl: 'https://cdn.example.test/preview.webp',
      thumbnailPath: 'generated/history.thumb.webp',
    })
    const resolveImageDetail = vi.fn(async () => detail)
    const references = useImageNodeReferences({
      historyImageForNode: () => historyImage({ id: 'history_1' }),
      referencedImageNodes: () => [node],
      resolveImageDetail,
    })

    await expect(references.buildReferences(imageNode({ id: 'generation_1', imageUrl: undefined })))
      .resolves.toEqual([expect.objectContaining({
        id: 'image_history',
        title: '图片1',
        storagePath: 'generated/history.webp',
        previewUrl: 'https://cdn.example.test/preview.webp',
      })])
    expect(node.storagePath).toBe('generated/history.webp')
    expect(node.imageUrl).toBe('https://cdn.example.test/preview.webp')
    expect(resolveImageDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'history_1' }), 'mine', { requireStoragePath: true })
  })
})
