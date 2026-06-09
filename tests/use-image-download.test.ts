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

  it('prefers a node storage original url before requesting detail', async () => {
    const detail = vi.fn()
    const downloader = useImageDownload({
      resolveImageDetail: detail,
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => image({
        id: 'history_node',
        storagePath: 'history/history_node.webp',
        thumbnailUrl: 'https://project.supabase.co/storage/v1/object/public/recho-images/thumbs/history_node.webp',
      }),
      historyImageForViewer: () => null,
      setError: vi.fn(),
    })

    await downloader.downloadTarget(downloader.nodeTarget({
      id: 'node_1',
      title: '节点图',
      content: '',
      imageUrl: 'https://project.supabase.co/storage/v1/object/public/recho-images/previews/node_1.webp',
      storagePath: 'nodes/node_1.webp',
    }))

    expect(downloadMocks.downloadImage).toHaveBeenCalledWith({
      imageUrl: 'https://project.supabase.co/storage/v1/object/public/recho-images/nodes/node_1.webp',
      title: '节点图',
    })
    expect(detail).not.toHaveBeenCalled()
  })

  it('falls back to node imageUrl when no node storage or history image is available', async () => {
    const detail = vi.fn()
    const setError = vi.fn()
    const downloader = useImageDownload({
      resolveImageDetail: detail,
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => null,
      historyImageForViewer: () => null,
      setError,
    })

    await downloader.downloadTarget(downloader.nodeTarget({
      id: 'node_2',
      title: '节点图',
      content: '节点标题',
      imageUrl: 'https://cdn.example.test/node-fallback.webp',
    }))

    expect(downloadMocks.downloadImage).toHaveBeenCalledWith({
      imageUrl: 'https://cdn.example.test/node-fallback.webp',
      title: '节点标题',
    })
    expect(detail).not.toHaveBeenCalled()
    expect(setError).not.toHaveBeenCalled()
  })

  it('builds viewer targets from history images when available and viewer urls otherwise', () => {
    const historyImage = image({
      id: 'viewer_history',
      storagePath: 'history/viewer_history.webp',
      thumbnailUrl: 'https://project.supabase.co/storage/v1/object/public/recho-images/thumbs/viewer_history.webp',
    })
    const viewer = {
      imageUrl: 'https://cdn.example.test/viewer-fallback.webp',
      title: '查看器',
      sourceImageId: 'viewer_history',
      sourceScope: 'public' as const,
    }
    const downloaderWithHistory = useImageDownload({
      resolveImageDetail: vi.fn(),
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => null,
      historyImageForViewer: () => historyImage,
      setError: vi.fn(),
    })
    const downloaderWithoutHistory = useImageDownload({
      resolveImageDetail: vi.fn(),
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => null,
      historyImageForViewer: () => null,
      setError: vi.fn(),
    })

    expect(downloaderWithHistory.viewerTarget(viewer)).toMatchObject({
      key: 'history:public:viewer_history',
      title: 'viewer_history.webp',
      directUrl: 'https://project.supabase.co/storage/v1/object/public/recho-images/history/viewer_history.webp',
    })
    expect(downloaderWithoutHistory.viewerTarget(viewer)).toMatchObject({
      key: 'history:public:viewer_history',
      title: '查看器',
      directUrl: 'https://cdn.example.test/viewer-fallback.webp',
    })
  })

  it('preloads only targets that have a direct url', () => {
    const downloader = useImageDownload({
      resolveImageDetail: vi.fn(),
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => null,
      historyImageForViewer: () => null,
      setError: vi.fn(),
    })

    downloader.preloadTarget({
      key: 'direct',
      title: '可预载',
      directUrl: 'https://cdn.example.test/preload.webp',
    })
    downloader.preloadTarget({
      key: 'deferred',
      title: '延迟',
      resolveUrl: async () => 'https://cdn.example.test/later.webp',
    })
    downloader.preloadTarget(null)

    expect(downloadMocks.preloadImageDownload).toHaveBeenCalledTimes(1)
    expect(downloadMocks.preloadImageDownload).toHaveBeenCalledWith({
      imageUrl: 'https://cdn.example.test/preload.webp',
      title: '可预载',
    })
  })

  it('generates stable keys for generated images, nodes, and viewers', () => {
    const downloader = useImageDownload({
      resolveImageDetail: vi.fn(),
      imageFileName: item => `${item.id}.webp`,
      historyImageForNode: () => null,
      historyImageForViewer: () => null,
      setError: vi.fn(),
    })

    expect(downloader.imageDownloadKey(image({ id: 'gen_1' }))).toBe('history:mine:gen_1')
    expect(downloader.imageDownloadKey(image({ id: 'gen_1' }), 'public')).toBe('history:public:gen_1')
    expect(downloader.nodeDownloadKey({
      id: 'node_1',
      title: '节点',
      content: '',
      imageUrl: 'https://cdn.example.test/node.webp',
    })).toBe('node:node_1')
    expect(downloader.nodeDownloadKey({
      id: 'node_2',
      title: '节点',
      content: '',
      imageUrl: 'https://cdn.example.test/node.webp',
      sourceImageId: 'history_2',
      sourceHistoryScope: 'public',
    })).toBe('history:public:history_2')
    expect(downloader.viewerDownloadKey({
      imageUrl: 'https://cdn.example.test/viewer.webp',
      title: '查看器',
    })).toBe('viewer:https://cdn.example.test/viewer.webp')
    expect(downloader.viewerDownloadKey({
      imageUrl: 'https://cdn.example.test/viewer.webp',
      title: '查看器',
      sourceImageId: 'history_3',
    })).toBe('history:mine:history_3')
  })
})
