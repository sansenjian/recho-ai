import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGalleryDetailPreview } from '../src/composables/useGalleryDetailPreview'
import type { GeneratedImage } from '../src/types/image'

const canvasUtils = vi.hoisted(() => ({
  preloadImageUrl: vi.fn(async () => undefined),
}))

vi.mock('../src/lib/image-canvas-utils', () => canvasUtils)

function image(partial: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: partial.id || 'img_1',
    prompt: partial.prompt || 'prompt',
    dataUrl: partial.dataUrl,
    storagePath: partial.storagePath,
    previewUrl: partial.previewUrl,
    thumbnailUrl: partial.thumbnailUrl,
    size: partial.size || '1024x1024',
    aspectRatio: partial.aspectRatio,
    resolution: partial.resolution,
    quality: partial.quality,
    timestamp: partial.timestamp || '2026-06-09T00:00:00.000Z',
  }
}

describe('useGalleryDetailPreview', () => {
  beforeEach(() => {
    canvasUtils.preloadImageUrl.mockClear()
  })

  it('shows an immediate thumbnail and upgrades to the preview image', async () => {
    const detail = image({
      id: 'img_1',
      prompt: 'gallery prompt',
      previewUrl: 'https://cdn.example.test/preview.webp',
      thumbnailUrl: 'https://cdn.example.test/thumb.webp',
    })
    const preview = useGalleryDetailPreview({
      currentScope: () => 'public',
      resolveImageDetail: vi.fn(async () => detail),
      setError: vi.fn(),
    })

    await preview.openGalleryDetail(image({
      id: 'img_1',
      thumbnailUrl: 'https://cdn.example.test/thumb.webp',
    }))

    expect(canvasUtils.preloadImageUrl).toHaveBeenCalledWith('https://cdn.example.test/preview.webp')
    expect(preview.galleryDetail.value?.id).toBe('img_1')
    expect(preview.galleryDetailScope.value).toBe('public')
    expect(preview.galleryDetailImageUrl(detail)).toBe('https://cdn.example.test/preview.webp')
  })

  it('creates viewer state from the current gallery detail', async () => {
    const preview = useGalleryDetailPreview({
      currentScope: () => 'mine',
      resolveImageDetail: vi.fn(),
      setError: vi.fn(),
    })

    await preview.openGalleryDetail(image({
      id: 'img_viewer',
      prompt: 'viewer prompt',
      previewUrl: 'https://cdn.example.test/preview.webp',
      size: '1536x1024',
    }))

    expect(preview.createViewerState()).toMatchObject({
      imageUrl: 'https://cdn.example.test/preview.webp',
      title: 'viewer_prompt',
      caption: 'viewer prompt',
      loadingPreview: false,
      sourceImageId: 'img_viewer',
      sourceScope: 'mine',
    })
  })
})
