import { beforeEach, describe, expect, it, vi } from 'vitest'

let rows: Array<Record<string, unknown>> = []
let selectArgs: string[] = []
let upsertBatches: Array<Array<Record<string, unknown>>> = []
let removeStoragePathBatches: string[][] = []
let storeImageBufferCalls: Array<{
  mime: string
  pathHint: string
  options: Record<string, unknown>
}> = []
let storeImageDataUrlCalls: Array<{
  pathHint: string
  options: Record<string, unknown>
}> = []

function mockStoredImage(pathHint: string, options: Record<string, unknown> = {}) {
  const path = `${pathHint.replace(/\.[a-z0-9]+$/i, '')}.webp`
  const storagePath = options.provider === 'tencent-cos' ? `cos://${path}` : path
  const previewPath = storagePath.replace(/\.[a-z0-9]+$/i, '.preview.webp')
  const thumbnailPath = storagePath.replace(/\.[a-z0-9]+$/i, '.thumb.webp')
  return {
    publicUrl: `https://cdn.example.test/${storagePath}`,
    storagePath,
    previewUrl: `https://cdn.example.test/${previewPath}`,
    previewPath,
    thumbnailUrl: `https://cdn.example.test/${thumbnailPath}`,
    thumbnailPath,
    mime: 'image/webp',
    width: 1024,
    height: 1024,
    originalBytes: 100,
    previewBytes: 40,
    thumbnailBytes: 10,
  }
}

vi.mock('../backend/gateway/src/services/image-storage', () => ({
  imagePublicUrl: (path?: string | null) => path ? `https://cdn.example.test/${path}` : undefined,
  storeImageBuffer: vi.fn(async (_buffer: Buffer, mime: string, pathHint: string, options: Record<string, unknown> = {}) => {
    storeImageBufferCalls.push({ mime, pathHint, options })
    return mockStoredImage(pathHint, options)
  }),
  storeImageDataUrl: vi.fn(async (_dataUrl: string, pathHint: string, options: Record<string, unknown> = {}) => {
    storeImageDataUrlCalls.push({ pathHint, options })
    return mockStoredImage(pathHint, options)
  }),
  removeImageStoragePaths: vi.fn(async (paths: string[]) => {
    removeStoragePathBatches.push(paths)
    return true
  }),
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: () => {
      let deleteMode = false
      const currentResult = () => Promise.resolve({ data: rows, error: null })
      const query = {
        select: vi.fn((columns?: string) => {
          selectArgs.push(String(columns || ''))
          return deleteMode
            ? Promise.resolve({ data: rows.map(row => ({ id: row.id })), error: null })
            : query
        }),
        order: vi.fn(() => query),
        range: vi.fn(() => Promise.resolve({ data: rows, error: null })),
        eq: vi.fn((key: string, value: unknown) => {
          rows = rows.filter(row => row[key] === value)
          return query
        }),
        maybeSingle: vi.fn(() => Promise.resolve({ data: rows[0] || null, error: null })),
        upsert: vi.fn((batch: Array<Record<string, unknown>>) => {
          upsertBatches.push(batch)
          return Promise.resolve({ error: null })
        }),
        delete: vi.fn(() => {
          deleteMode = true
          return query
        }),
        then: (
          resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => currentResult().then(resolve, reject),
      }
      return query
    },
  }),
}))

describe('image history storage urls', () => {
  beforeEach(() => {
    rows = []
    selectArgs = []
    upsertBatches = []
    removeStoragePathBatches = []
    storeImageBufferCalls = []
    storeImageDataUrlCalls = []
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

  it('uses explicit lightweight columns for detail reads', async () => {
    const { getImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [{
      id: 'img_detail_1',
      data_url: 'data:image/png;base64,large-original',
      storage_path: 'generated/img_detail_1.webp',
      prompt: 'prompt',
      size: '1024x1024',
      visibility: 'public',
      funding_source: 'free',
      system_prompt: 'do-not-read',
      model_prompt: 'do-not-read',
      request_ip: '127.0.0.1',
      request_user_agent: 'secret-agent',
      generated_at: '2026-06-09T00:00:00.000Z',
    }]

    await getImageHistory('img_detail_1', { scope: 'public' })
    const columns = selectArgs[0]

    expect(columns).not.toBe('*')
    expect(columns.split(',')).not.toContain('data_url')
    expect(columns.split(',')).not.toContain('system_prompt')
    expect(columns.split(',')).not.toContain('model_prompt')
    expect(columns.split(',')).not.toContain('request_ip')
    expect(columns.split(',')).not.toContain('request_user_agent')
  })

  it('includes the original payload column only when requested', async () => {
    const { getImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [{
      id: 'img_detail_2',
      data_url: 'data:image/png;base64,large-original',
      prompt: 'prompt',
      size: '1024x1024',
      visibility: 'public',
      funding_source: 'free',
      generated_at: '2026-06-09T00:00:00.000Z',
    }]

    await getImageHistory('img_detail_2', { scope: 'public', includeOriginal: true })

    expect(selectArgs[0].split(',')).toContain('data_url')
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

  it('upserts stored history rows in bounded chunks', async () => {
    const { saveImageHistory } = await import('../backend/gateway/src/services/image-history')
    const images = Array.from({ length: 55 }, (_, index) => ({
      id: `img_chunk_${index}`,
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'prompt',
      size: '1024x1024',
      timestamp: '2026-06-09T00:00:00.000Z',
    }))

    await saveImageHistory(images)

    expect(upsertBatches).toHaveLength(2)
    expect(upsertBatches[0]).toHaveLength(50)
    expect(upsertBatches[1]).toHaveLength(5)
  })

  it('stores credit-funded generated images in Tencent COS while free images stay on Supabase storage', async () => {
    const { saveImageHistory } = await import('../backend/gateway/src/services/image-history')

    await saveImageHistory([
      {
        id: 'img_free_1',
        dataUrl: 'data:image/png;base64,AAAA',
        prompt: 'free prompt',
        size: '1024x1024',
        timestamp: '2026-06-09T00:00:00.000Z',
        fundingSource: 'free',
        visibility: 'public',
      },
      {
        id: 'img_credit_1',
        dataUrl: 'data:image/png;base64,BBBB',
        prompt: 'credit prompt',
        size: '1024x1024',
        timestamp: '2026-06-09T00:00:00.000Z',
        fundingSource: 'credit',
        visibility: 'private',
        creditCost: 0.25,
      },
    ], {
      allowCreditMetadata: true,
      allowCreditStorage: true,
    })

    expect(storeImageDataUrlCalls).toHaveLength(2)
    expect(storeImageDataUrlCalls[0]).toMatchObject({
      pathHint: 'generated/img_free_1',
      options: {},
    })
    expect(storeImageDataUrlCalls[1]).toMatchObject({
      pathHint: 'generated/img_credit_1',
      options: { provider: 'tencent-cos' },
    })

    const storedRows = upsertBatches.flat()
    expect(storedRows.find(row => row.id === 'img_free_1')).toMatchObject({
      storage_path: 'generated/img_free_1.webp',
      funding_source: 'free',
      visibility: 'public',
    })
    expect(storedRows.find(row => row.id === 'img_credit_1')).toMatchObject({
      storage_path: 'cos://generated/img_credit_1.webp',
      funding_source: 'credit',
      visibility: 'private',
      credit_cost: 0.25,
    })
  })

  it('does not trust client-supplied credit fields without a server opt-in', async () => {
    const { saveImageHistory } = await import('../backend/gateway/src/services/image-history')

    await saveImageHistory([
      {
        id: 'img_untrusted_credit_1',
        dataUrl: 'data:image/png;base64,CCCC',
        prompt: 'untrusted credit prompt',
        size: '1024x1024',
        timestamp: '2026-06-09T00:00:00.000Z',
        fundingSource: 'credit',
        visibility: 'private',
        creditCost: 99,
        creditTransactionId: 'client-controlled-transaction',
      },
    ])

    expect(storeImageDataUrlCalls).toHaveLength(1)
    expect(storeImageDataUrlCalls[0]).toMatchObject({
      pathHint: 'generated/img_untrusted_credit_1',
      options: {},
    })

    expect(upsertBatches.flat()[0]).toMatchObject({
      storage_path: 'generated/img_untrusted_credit_1.webp',
      funding_source: 'free',
      visibility: 'public',
      credit_cost: 0,
      credit_transaction_id: null,
    })
  })

  it('removes only generated storage files after deleting one history row', async () => {
    const { deleteImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [{
      id: 'img_delete_1',
      user_id: 'user_1',
      storage_path: 'generated/img_delete_1.webp',
      preview_path: 'generated/img_delete_1.preview.webp',
      thumbnail_path: 'generated/img_delete_1.thumb.webp',
      reference_images: [{
        storagePath: 'references/ref_1.webp',
        previewPath: 'references/ref_1.preview.webp',
        thumbnailPath: 'references/ref_1.thumb.webp',
      }],
    }]

    await expect(deleteImageHistory('img_delete_1', { userId: 'user_1' })).resolves.toBe(true)

    expect(removeStoragePathBatches[0]).toEqual([
      'generated/img_delete_1.webp',
      'generated/img_delete_1.preview.webp',
      'generated/img_delete_1.thumb.webp',
    ])
  })

  it('removes storage files after clearing a user history', async () => {
    const { clearImageHistory } = await import('../backend/gateway/src/services/image-history')
    rows = [
      {
        id: 'img_clear_1',
        user_id: 'user_1',
        storage_path: 'generated/img_clear_1.webp',
      },
      {
        id: 'img_clear_2',
        user_id: 'user_1',
        thumbnail_path: 'generated/img_clear_2.thumb.webp',
      },
    ]

    await expect(clearImageHistory({ userId: 'user_1' })).resolves.toBe(true)

    expect(removeStoragePathBatches[0]).toEqual([
      'generated/img_clear_1.webp',
      'generated/img_clear_2.thumb.webp',
    ])
  })
})
