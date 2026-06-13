import { beforeEach, describe, expect, it, vi } from 'vitest'

const png1x1DataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

let deletedCosKeys: string[] = []
let putCosObjects: Array<{
  key: string
  contentType: string
  cacheControl: string
  bytes: number
}> = []
let cosPublicBaseUrl = ''

function encodeKey(key: string) {
  return key
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/')
}

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: vi.fn(() => null),
}))

vi.mock('../backend/gateway/src/clients/tencent-cos', () => ({
  hasTencentCosConfig: vi.fn(() => true),
  tencentCosObjectUrl: vi.fn((key: string) => cosPublicBaseUrl ? `${cosPublicBaseUrl}/${encodeKey(key)}` : undefined),
  deleteTencentCosObject: vi.fn(async (key: string) => {
    deletedCosKeys.push(key)
    return true
  }),
  getTencentCosObject: vi.fn(async (key: string) => ({
    buffer: Buffer.from(`cos:${key}`),
    mime: 'image/webp',
  })),
  putTencentCosObject: vi.fn(async (options: {
    key: string
    body: Buffer
    contentType: string
    cacheControl: string
  }) => {
    putCosObjects.push({
      key: options.key,
      contentType: options.contentType,
      cacheControl: options.cacheControl,
      bytes: options.body.byteLength,
    })
    return {
      publicUrl: cosPublicBaseUrl ? `${cosPublicBaseUrl}/${encodeKey(options.key)}` : '',
      storagePath: `cos://${options.key}`,
    }
  }),
}))

describe('image storage Tencent COS support', () => {
  beforeEach(() => {
    deletedCosKeys = []
    putCosObjects = []
    cosPublicBaseUrl = 'https://cos.example.test'
    vi.clearAllMocks()
  })

  it('uses the backend proxy for COS paths when no public base url is configured', async () => {
    cosPublicBaseUrl = ''
    const {
      imagePublicUrl,
      imagePreviewPath,
      imageThumbnailPath,
    } = await import('../backend/gateway/src/services/image-storage')

    expect(imagePublicUrl('cos://generated/a b.webp')).toBe('/api/image/storage/cos%3A%2F%2Fgenerated%2Fa%20b.webp')
    expect(imagePreviewPath('cos://generated/a b.webp')).toBe('cos://generated/a b.preview.webp')
    expect(imageThumbnailPath('cos://generated/a b.webp')).toBe('cos://generated/a b.thumb.webp')
  })

  it('downloads and deletes COS objects through the COS client wrapper', async () => {
    const {
      downloadImageBuffer,
      removeImageStoragePaths,
    } = await import('../backend/gateway/src/services/image-storage')

    await expect(downloadImageBuffer('cos://generated/img_1.webp')).resolves.toMatchObject({
      buffer: Buffer.from('cos:generated/img_1.webp'),
      mime: 'image/webp',
    })

    await expect(removeImageStoragePaths([
      'cos://generated/img_1.webp',
      'cos://generated/img_1.thumb.webp',
    ])).resolves.toBe(true)

    expect(deletedCosKeys).toEqual([
      'generated/img_1.webp',
      'generated/img_1.thumb.webp',
    ])
  })

  it('stores credit-funded originals, previews, and thumbnails in COS', async () => {
    const { storeImageDataUrl } = await import('../backend/gateway/src/services/image-storage')

    const stored = await storeImageDataUrl(
      png1x1DataUrl,
      'generated/img_credit_1',
      { provider: 'tencent-cos' },
    )

    expect(stored).toMatchObject({
      publicUrl: 'https://cos.example.test/generated/img_credit_1.webp',
      storagePath: 'cos://generated/img_credit_1.webp',
      previewPath: 'cos://generated/img_credit_1.preview.webp',
      thumbnailPath: 'cos://generated/img_credit_1.thumb.webp',
      mime: 'image/webp',
    })
    expect(putCosObjects.map(item => item.key)).toEqual([
      'generated/img_credit_1.webp',
      'generated/img_credit_1.preview.webp',
      'generated/img_credit_1.thumb.webp',
    ])
    expect(putCosObjects.every(item => item.contentType === 'image/webp')).toBe(true)
    expect(putCosObjects.every(item => item.cacheControl === 'max-age=31536000')).toBe(true)
  })
})
