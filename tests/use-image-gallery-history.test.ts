import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/composables/useAuthSession', () => ({
  getAuthAccessToken: vi.fn(async () => null),
  getAuthIdentity: vi.fn(async () => ({ accessToken: null, userId: null })),
  useAuthSession: () => ({ user: ref(null) }),
}))

vi.mock('../src/composables/useCredits', () => ({
  useCredits: () => ({ setCreditBalance: vi.fn() }),
}))

vi.mock('../src/composables/useAppConfig', () => ({
  ensureAppConfig: vi.fn(async () => ({ guestGenerationEnabled: true })),
}))

vi.mock('../src/lib/api-base', () => ({
  imageApiUrl: (path: string) => path,
}))

import { useImageGen } from '../src/composables/useImageGen'

function createGallery() {
  const scope = effectScope()
  const gallery = scope.run(() => useImageGen())
  if (!gallery) throw new Error('failed to create image gallery composable')
  return { gallery, scope }
}

function galleryPage(id: string, hasMore = false, nextOffset: number | null = null) {
  return new Response(JSON.stringify({
    images: [{
      id,
      prompt: `prompt-${id}`,
      thumbnailUrl: `https://images.example.test/${id}.webp`,
      size: '1024x1024',
      timestamp: '2026-08-13T00:00:00.000Z',
    }],
    hasMore,
    nextOffset,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('public image gallery history', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback) => {
      queueMicrotask(() => {
        if (typeof callback === 'function') callback()
      })
      return 0 as ReturnType<typeof setTimeout>
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not turn a failed initial load into a permanently loaded empty gallery', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 502, statusText: 'Bad Gateway' }))
      .mockResolvedValueOnce(new Response(null, { status: 502, statusText: 'Bad Gateway' }))
      .mockResolvedValueOnce(galleryPage('image-1'))

    const { gallery, scope } = createGallery()
    await gallery.ensureGalleryLoaded()

    expect(gallery.galleryLoaded.value).toBe(false)
    expect(gallery.galleryImages.value).toEqual([])
    expect(gallery.galleryError.value).toBeTruthy()

    await gallery.ensureGalleryLoaded()

    expect(gallery.galleryLoaded.value).toBe(true)
    expect(gallery.galleryImages.value.map(image => image.id)).toEqual(['image-1'])
    expect(gallery.galleryError.value).toBeNull()
    scope.stop()
  })

  it('preserves existing images and pagination after a load-more failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(galleryPage('image-1', true, 12))
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(galleryPage('image-2', false, null))

    const { gallery, scope } = createGallery()
    await gallery.ensureGalleryLoaded()
    await gallery.loadMoreGalleryHistory()

    expect(gallery.galleryImages.value.map(image => image.id)).toEqual(['image-1'])
    expect(gallery.hasMoreGallery.value).toBe(true)
    expect(gallery.galleryError.value).toBeTruthy()

    await gallery.loadMoreGalleryHistory()

    expect(gallery.galleryImages.value.map(image => image.id)).toEqual(['image-1', 'image-2'])
    expect(gallery.hasMoreGallery.value).toBe(false)
    expect(gallery.galleryError.value).toBeNull()
    const requestedUrls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(requestedUrls.filter(url => url.includes('offset=12'))).toHaveLength(3)
    scope.stop()
  })
})
