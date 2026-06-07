import { beforeEach, describe, expect, it, vi } from 'vitest'

let rows: Array<Record<string, unknown>> = []
let updatedVisibility: string | null = null

vi.mock('../backend/gateway/src/services/image-storage', () => ({
  imagePublicUrl: (path?: string | null) => path ? `https://cdn.example.test/${path}` : undefined,
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: { user: { id, email: `${id}@example.test` } },
          error: null,
        })),
      },
    },
    from: () => {
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
        eq: vi.fn((_key: string, value: unknown) => {
          rows = rows.filter(row => row.id === value || row.visibility === value)
          return query
        }),
        update: vi.fn((patch: Record<string, unknown>) => {
          updatedVisibility = typeof patch.visibility === 'string' ? patch.visibility : null
          rows = rows.map(row => ({ ...row, ...patch }))
          return query
        }),
        maybeSingle: vi.fn(() => Promise.resolve({ data: rows[0] || null, error: null })),
      }
      return query
    },
  }),
}))

describe('admin image helpers', () => {
  beforeEach(() => {
    rows = []
    updatedVisibility = null
    vi.resetModules()
  })

  it('returns redacted, lightweight image summaries for admin lists', async () => {
    const { listAdminImages } = await import('../backend/gateway/src/services/admin-images')
    rows = [{
      id: 'img_1',
      user_id: 'user_1',
      data_url: 'data:image/png;base64,do-not-return',
      request_ip: '127.0.0.1',
      prompt: 'fallback prompt',
      user_prompt: 'make image with api_key=sk-secret-value-that-should-not-leak-123456',
      thumbnail_path: 'thumbs/img_1.webp',
      preview_url: 'https://preview.example.test/img_1.webp',
      visibility: 'public',
      funding_source: 'free',
      credit_cost: 0,
      size: '1024x1024',
      quality: 'high',
      generated_at: '2026-06-08T12:00:00.000Z',
    }]

    const images = await listAdminImages({ limit: 10 })

    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({
      id: 'img_1',
      userId: 'user_1',
      email: 'user_1@example.test',
      thumbnailUrl: 'https://cdn.example.test/thumbs/img_1.webp',
      previewUrl: 'https://preview.example.test/img_1.webp',
      visibility: 'public',
      fundingSource: 'free',
      creditCost: 0,
      size: '1024x1024',
      quality: 'high',
    })
    expect(images[0].prompt).toContain('[redacted-secret]')
    expect(JSON.stringify(images[0])).not.toContain('data:image/png')
    expect(JSON.stringify(images[0])).not.toContain('127.0.0.1')
    expect(JSON.stringify(images[0])).not.toContain('sk-secret')
  })

  it('prevents credit-funded private images from being published', async () => {
    const { setAdminImageVisibility } = await import('../backend/gateway/src/services/admin-images')
    rows = [{
      id: 'img_credit',
      user_id: 'user_1',
      visibility: 'private',
      funding_source: 'credit',
      credit_cost: 3,
      prompt: 'private prompt',
      generated_at: '2026-06-08T12:00:00.000Z',
    }]

    await expect(setAdminImageVisibility('img_credit', 'public')).rejects.toMatchObject({
      message: 'credit_image_must_stay_private',
    })
    expect(updatedVisibility).toBeNull()
  })

  it('updates visibility for free images', async () => {
    const { setAdminImageVisibility } = await import('../backend/gateway/src/services/admin-images')
    rows = [{
      id: 'img_free',
      user_id: 'user_2',
      visibility: 'private',
      funding_source: 'free',
      credit_cost: 0,
      prompt: 'free prompt',
      generated_at: '2026-06-08T12:00:00.000Z',
    }]

    const image = await setAdminImageVisibility('img_free', 'public')

    expect(updatedVisibility).toBe('public')
    expect(image.visibility).toBe('public')
  })
})
