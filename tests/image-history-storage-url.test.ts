import { beforeEach, describe, expect, it, vi } from 'vitest'

let rows: Array<Record<string, unknown>> = []

vi.mock('../backend/gateway/src/services/image-storage', () => ({
  imagePublicUrl: (path?: string | null) => path ? `https://cdn.example.test/${path}` : undefined,
  storeImageBuffer: vi.fn(),
  storeImageDataUrl: vi.fn(),
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: () => {
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn(() => Promise.resolve({ data: rows, error: null })),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(() => Promise.resolve({ data: rows[0] || null, error: null })),
      }
      return query
    },
  }),
}))

describe('image history storage urls', () => {
  beforeEach(() => {
    rows = []
    vi.resetModules()
  })

  it('uses storage paths before stale stored urls in public summaries', async () => {
    const { listImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [{
      id: 'img_1',
      storage_path: 'generated/img_1.webp',
      preview_path: 'generated/img_1.preview.webp',
      preview_url: 'https://old.example.test/broken-preview.webp',
      thumbnail_path: 'generated/img_1.thumb.webp',
      thumbnail_url: 'https://old.example.test/broken-thumb.webp',
      prompt: 'prompt',
      size: '1024x1024',
      visibility: 'public',
      funding_source: 'free',
      generated_at: '2026-06-09T00:00:00.000Z',
    }]

    const history = await listImageHistory(12, 0, { scope: 'public' })

    expect(history.images[0]).toMatchObject({
      previewUrl: 'https://cdn.example.test/generated/img_1.preview.webp',
      thumbnailUrl: 'https://cdn.example.test/generated/img_1.thumb.webp',
    })
  })

  it('does not return bare filenames as image urls', async () => {
    const { getImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [{
      id: 'img_2',
      data_url: 'img_1780573040016_0.webp',
      storage_path: 'generated/img_2.webp',
      preview_url: 'img_1780573040016_0.preview.webp',
      thumbnail_url: 'img_1780573040016_0.thumb.webp',
      prompt: 'prompt',
      size: '1024x1024',
      visibility: 'public',
      funding_source: 'free',
      generated_at: '2026-06-09T00:00:00.000Z',
    }]

    const image = await getImageHistory('img_2', { scope: 'public', includeOriginal: true })

    expect(image).toMatchObject({
      dataUrl: 'https://cdn.example.test/generated/img_2.webp',
      previewUrl: 'https://cdn.example.test/generated/img_2.webp',
      thumbnailUrl: 'https://cdn.example.test/generated/img_2.webp',
    })
    expect(JSON.stringify(image)).not.toContain('img_1780573040016_0.thumb.webp')
  })

  it('prefers storage paths for reference images and filters bare filenames', async () => {
    const { listImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [{
      id: 'img_ref_1',
      storage_path: 'generated/img_ref_1.webp',
      preview_path: 'generated/img_ref_1.preview.webp',
      preview_url: 'https://old.example.test/broken-preview.webp',
      thumbnail_path: 'generated/img_ref_1.thumb.webp',
      thumbnail_url: 'https://old.example.test/broken-thumb.webp',
      prompt: 'prompt',
      size: '1024x1024',
      visibility: 'public',
      funding_source: 'free',
      reference_images: [
        {
          id: 'ref_1',
          title: '参考图 1',
          storagePath: 'reference/ref_1.webp',
          previewPath: 'reference/ref_1.preview.webp',
          previewUrl: 'https://old.example.test/reference/preview.webp',
          thumbnailPath: 'reference/ref_1.thumb.webp',
          thumbnailUrl: 'https://old.example.test/reference/thumb.webp',
        },
        {
          id: 'ref_2',
          title: '参考图 2',
          storagePath: 'reference/ref_2.webp',
          previewUrl: 'bare-preview.webp',
          thumbnailUrl: 'bare-thumb.webp',
        },
      ],
      generated_at: '2026-06-09T00:00:00.000Z',
    }]

    const history = await listImageHistory(12, 0, { scope: 'public' })

    expect(history.images[0]?.references).toHaveLength(2)
    expect(history.images[0]?.references?.[0]).toMatchObject({
      dataUrl: 'https://cdn.example.test/reference/ref_1.thumb.webp',
      previewUrl: 'https://cdn.example.test/reference/ref_1.preview.webp',
      thumbnailUrl: 'https://cdn.example.test/reference/ref_1.thumb.webp',
    })
    expect(history.images[0]?.references?.[1]).toMatchObject({
      dataUrl: 'https://cdn.example.test/reference/ref_2.webp',
      storagePath: 'reference/ref_2.webp',
    })
    expect(JSON.stringify(history.images[0]?.references)).not.toContain('bare-preview.webp')
    expect(JSON.stringify(history.images[0]?.references)).not.toContain('bare-thumb.webp')
  })

  it('prefers storage paths over stale urls for private history scopes', async () => {
    const { listImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [{
      id: 'img_mine_1',
      user_id: 'user_1',
      storage_path: 'generated/img_mine_1.webp',
      preview_path: 'generated/img_mine_1.preview.webp',
      preview_url: 'https://old.example.test/broken-preview.webp',
      thumbnail_path: 'generated/img_mine_1.thumb.webp',
      thumbnail_url: 'https://old.example.test/broken-thumb.webp',
      prompt: 'prompt',
      size: '1024x1024',
      visibility: 'private',
      funding_source: 'free',
      generated_at: '2026-06-09T00:00:00.000Z',
    }]

    const history = await listImageHistory(12, 0, { scope: 'mine', userId: 'user_1' })

    expect(history.images[0]).toMatchObject({
      previewUrl: 'https://cdn.example.test/generated/img_mine_1.preview.webp',
      thumbnailUrl: 'https://cdn.example.test/generated/img_mine_1.thumb.webp',
    })
    expect(history.images[0]?.previewUrl).not.toBe('https://old.example.test/broken-preview.webp')
    expect(history.images[0]?.thumbnailUrl).not.toBe('https://old.example.test/broken-thumb.webp')
  })

  it('accepts inline reference data urls while rejecting bare thumbnail filenames', async () => {
    const { listImageHistory } = await import('../backend/gateway/src/services/image-history')
    const inlineDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA'
    rows = [{
      id: 'img_data_1',
      storage_path: 'generated/img_data_1.webp',
      preview_path: 'generated/img_data_1.preview.webp',
      preview_url: 'https://old.example.test/broken-preview.webp',
      thumbnail_path: null,
      thumbnail_url: 'bare-thumb.webp',
      prompt: 'prompt',
      size: '1024x1024',
      visibility: 'public',
      funding_source: 'free',
      reference_images: [
        {
          id: 'ref_inline',
          title: '内联参考图',
          dataUrl: inlineDataUrl,
          thumbnailUrl: 'bare-reference-thumb.webp',
        },
      ],
      generated_at: '2026-06-09T00:00:00.000Z',
    }]

    const history = await listImageHistory(12, 0, { scope: 'public' })

    expect(history.images[0]?.thumbnailUrl).toBe('https://cdn.example.test/generated/img_data_1.preview.webp')
    expect(history.images[0]?.thumbnailUrl).not.toBe('bare-thumb.webp')
    expect(history.images[0]?.references?.[0]).toMatchObject({
      dataUrl: inlineDataUrl,
      thumbnailUrl: undefined,
    })
    expect(JSON.stringify(history.images[0])).not.toContain('bare-reference-thumb.webp')
  })
})
