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
})
