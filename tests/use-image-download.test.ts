import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageDownload } from '../src/composables/useImageDownload'
import type { GeneratedImage } from '../src/types/image'

const downloadMocks = vi.hoisted(() => ({
  downloadImage: vi.fn(),
  preloadImageDownload: vi.fn(),
}))

vi.mock('../src/lib/image-download', () => downloadMocks)

function image(partial: Partial<GeneratedImage>): GeneratedImage {
  return {
    id: partial.id || 'img_1',
    prompt: partial.prompt || 'prompt',
    dataUrl: partial.dataUrl,
    storagePath: partial.storagePath,
    previewUrl: partial.previewUrl,
    thumbnailUrl: partial.thumbnailUrl,
    size: partial.size,
    aspectRatio: partial.aspectRatio,
    resolution: partial.resolution,
    quality: partial.quality,
    references: partial.references,
    referenceImageCount: partial.referenceImageCount,
    timestamp: partial.timestamp || '2026-06-09T00:00:00.000Z',
  }
}

describe('useImageDownload', () => {
  beforeEach(() => {
    downloadMocks.downloadImage.mockReset()
    downloadMocks.preloadImageDownload.mockReset()
  })

  it('preloads and downloads the inferred storage original without requesting detail', async () => {
    const detail = vi.fn()
    const downloader = useImageDownload({
      resolveImageDetail: detail,
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => null,
      historyImageForViewer: () => null,
      setError: vi.fn(),
    })

    const target = downloader.generatedImageTarget(image({
      id: 'img_storage',
      storagePath: 'originals/img_storage.webp',
      thumbnailUrl: 'https://project.supabase.co/storage/v1/object/public/recho-images/thumbs/img_storage.webp',
    }))

    downloader.preloadTarget(target)
    await downloader.downloadTarget(target)

    const expectedUrl = 'https://project.supabase.co/storage/v1/object/public/recho-images/originals/img_storage.webp'
    expect(downloadMocks.preloadImageDownload).toHaveBeenCalledWith({
      imageUrl: expectedUrl,
      title: 'img_storage.webp',
    })
    expect(downloadMocks.downloadImage).toHaveBeenCalledWith({
      imageUrl: expectedUrl,
      title: 'img_storage.webp',
    })
    expect(detail).not.toHaveBeenCalled()
  })

  it('resolves detail only when a direct original url is unavailable', async () => {
    const detailImage = image({
      id: 'img_detail',
      dataUrl: 'data:image/webp;base64,original',
    })
    const detail = vi.fn().mockResolvedValue(detailImage)
    const setError = vi.fn()
    const downloader = useImageDownload({
      resolveImageDetail: detail,
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => null,
      historyImageForViewer: () => null,
      setError,
    })

    await downloader.downloadTarget(downloader.generatedImageTarget(image({ id: 'img_detail' })))

    expect(detail).toHaveBeenCalledWith(expect.objectContaining({ id: 'img_detail' }), 'mine', { includeOriginal: true })
    expect(downloadMocks.downloadImage).toHaveBeenCalledWith({
      imageUrl: 'data:image/webp;base64,original',
      title: 'img_detail.webp',
    })
    expect(setError).not.toHaveBeenCalled()
  })
})
