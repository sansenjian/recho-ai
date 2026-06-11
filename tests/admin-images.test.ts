import { beforeEach, describe, expect, it, vi } from 'vitest'

let rows: Array<Record<string, unknown>> = []
let updatedVisibility: string | null = null
let orFilter: string | null = null
let removedStoragePaths: Array<string | null | undefined> = []
let storageRemoveError: Error | null = null

vi.mock('../backend/gateway/src/services/image-storage', () => ({
  imagePublicUrl: (path?: string | null) => path ? `https://cdn.example.test/${path}` : undefined,
  removeImageStoragePaths: vi.fn(async (paths: Array<string | null | undefined>) => {
    removedStoragePaths = paths
    if (storageRemoveError) throw storageRemoveError
  }),
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
      let pendingPatch: Record<string, unknown> | null = null
      let deleting = false
      let resultRows = rows
      function applyFilter(key: string, values: unknown[]) {
        const valueSet = new Set(values)
        const matched = resultRows.filter(row => valueSet.has(row[key]))
        if (pendingPatch) {
          rows = rows.map(row => valueSet.has(row[key]) ? { ...row, ...pendingPatch } : row)
          resultRows = rows.filter(row => valueSet.has(row[key]))
          return
        }
        if (deleting) {
          rows = rows.filter(row => !valueSet.has(row[key]))
          resultRows = matched
          return
        }
        resultRows = matched
      }
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve({ data: resultRows, error: null })),
        eq: vi.fn((key: string, value: unknown) => {
          applyFilter(key, [value])
          resultRows = resultRows.filter(row => {
            if (key === 'id') return row.id === value
            if (key === 'visibility') return row.visibility === value
            if (key === 'funding_source') return row.funding_source === value
            if (key === 'user_id') return row.user_id === value
            return false
          })
          return query
        }),
        in: vi.fn((key: string, values: unknown[]) => {
          applyFilter(key, values)
          return query
        }),
        or: vi.fn((filter: string) => {
          orFilter = filter
          const match = /%([^%]+)%/.exec(filter)
          const term = (match?.[1] || '').toLowerCase()
          resultRows = term
            ? resultRows.filter(row => String(row.user_prompt || row.prompt || '').toLowerCase().includes(term))
            : resultRows
          return query
        }),
        update: vi.fn((patch: Record<string, unknown>) => {
          updatedVisibility = typeof patch.visibility === 'string' ? patch.visibility : null
          pendingPatch = patch
          deleting = false
          return query
        }),
        delete: vi.fn(() => {
          deleting = true
          pendingPatch = null
          return query
        }),
        maybeSingle: vi.fn(() => Promise.resolve({ data: resultRows[0] || null, error: null })),
        then: (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown, reject?: (reason: unknown) => unknown) => (
          Promise.resolve({ data: resultRows, error: null }).then(resolve, reject)
        ),
      }
      return query
    },
  }),
}))

describe('admin image helpers', () => {
  beforeEach(() => {
    rows = []
    updatedVisibility = null
    orFilter = null
    removedStoragePaths = []
    storageRemoveError = null
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
      thumbnail_url: 'https://old.example.test/broken-thumb.webp',
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

  it('filters by visibility, funding source, user, and sanitized prompt search', async () => {
    const { listAdminImages } = await import('../backend/gateway/src/services/admin-images')
    rows = [
      {
        id: 'img_keep',
        user_id: 'user_keep',
        visibility: 'private',
        funding_source: 'credit',
        user_prompt: 'quiet mountain',
        generated_at: '2026-06-08T12:00:00.000Z',
      },
      {
        id: 'img_wrong_source',
        user_id: 'user_keep',
        visibility: 'private',
        funding_source: 'free',
        user_prompt: 'quiet mountain',
        generated_at: '2026-06-08T12:01:00.000Z',
      },
      {
        id: 'img_wrong_user',
        user_id: 'user_other',
        visibility: 'private',
        funding_source: 'credit',
        user_prompt: 'quiet mountain',
        generated_at: '2026-06-08T12:02:00.000Z',
      },
    ]

    const images = await listAdminImages({
      visibility: 'private',
      fundingSource: 'credit',
      userId: 'user_keep',
      query: 'quiet,%()mountain',
    })

    expect(images.map(image => image.id)).toEqual(['img_keep'])
    expect(orFilter).toContain('quiet mountain')
    expect(orFilter).not.toContain('quiet,%()mountain')
    expect(orFilter).not.toContain('%()')
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

  it('archives multiple images with one visibility update', async () => {
    const { bulkArchiveAdminImages } = await import('../backend/gateway/src/services/admin-images')
    rows = [
      {
        id: 'img_1',
        user_id: 'user_1',
        visibility: 'public',
        funding_source: 'free',
        generated_at: '2026-06-08T12:00:00.000Z',
      },
      {
        id: 'img_2',
        user_id: 'user_2',
        visibility: 'public',
        funding_source: 'credit',
        generated_at: '2026-06-08T12:01:00.000Z',
      },
    ]

    const images = await bulkArchiveAdminImages(['img_1', 'img_2'])

    expect(updatedVisibility).toBe('private')
    expect(images.map(image => image.visibility)).toEqual(['private', 'private'])
  })

  it('deletes selected images and removes generated storage files', async () => {
    const { bulkDeleteAdminImages } = await import('../backend/gateway/src/services/admin-images')
    rows = [
      {
        id: 'img_1',
        user_id: 'user_1',
        storage_path: 'generated/img_1.webp',
        preview_path: 'generated/img_1.preview.webp',
        thumbnail_path: 'generated/img_1.thumb.webp',
        visibility: 'private',
        funding_source: 'free',
        generated_at: '2026-06-08T12:00:00.000Z',
      },
      {
        id: 'img_2',
        user_id: 'user_2',
        storage_path: 'cos://generated/img_2.webp',
        preview_path: 'cos://generated/img_2.preview.webp',
        thumbnail_path: 'cos://generated/img_2.thumb.webp',
        visibility: 'private',
        funding_source: 'credit',
        generated_at: '2026-06-08T12:01:00.000Z',
      },
    ]

    const result = await bulkDeleteAdminImages(['img_1', 'img_2'])

    expect(result).toEqual({
      deletedIds: ['img_1', 'img_2'],
      deletedCount: 2,
    })
    expect(removedStoragePaths).toEqual([
      'generated/img_1.webp',
      'generated/img_1.preview.webp',
      'generated/img_1.thumb.webp',
      'cos://generated/img_2.webp',
      'cos://generated/img_2.preview.webp',
      'cos://generated/img_2.thumb.webp',
    ])
    expect(rows).toEqual([])
  })

  it('returns success when storage cleanup fails after deleting images', async () => {
    const { bulkDeleteAdminImages } = await import('../backend/gateway/src/services/admin-images')
    rows = [{
      id: 'img_1',
      user_id: 'user_1',
      storage_path: 'generated/img_1.webp',
      visibility: 'private',
      funding_source: 'free',
      generated_at: '2026-06-08T12:00:00.000Z',
    }]
    storageRemoveError = new Error('storage unavailable')

    await expect(bulkDeleteAdminImages(['img_1'])).resolves.toEqual({
      deletedIds: ['img_1'],
      deletedCount: 1,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(removedStoragePaths).toEqual(['generated/img_1.webp', null, null])
    expect(rows).toEqual([])
  })
})
