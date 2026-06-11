import { describe, expect, it } from 'vitest'
import {
  encodedStoragePath,
  originalImageDownloadUrl,
  originalStorageImageUrl,
} from '../src/lib/image-storage-url'

describe('image storage url helpers', () => {
  it('encodes storage paths segment by segment', () => {
    expect(encodedStoragePath('users/a b/图像.webp')).toBe('users/a%20b/%E5%9B%BE%E5%83%8F.webp')
  })

  it('infers the original public storage url from a thumbnail url and storage path', () => {
    expect(originalStorageImageUrl(
      'users/u1/original file.webp',
      'https://project.supabase.co/storage/v1/object/public/recho-images/thumbs/u1/thumb.webp?width=320',
    )).toBe('https://project.supabase.co/storage/v1/object/public/recho-images/users/u1/original%20file.webp')
  })

  it('infers the original COS url from a thumbnail url and COS storage path', () => {
    expect(originalStorageImageUrl(
      'cos://generated/img_1.webp',
      'https://images.example.test/generated/img_1.thumb.webp?imageMogr2/thumbnail/480x',
    )).toBe('https://images.example.test/generated/img_1.webp')
  })

  it('falls back to the embedded image data when no storage url can be inferred', () => {
    expect(originalImageDownloadUrl({
      dataUrl: 'data:image/webp;base64,abc',
      storagePath: 'images/original.webp',
    })).toBe('data:image/webp;base64,abc')
  })
})
