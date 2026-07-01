import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('useAppConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries config loading after a failed fetch instead of caching fallback forever', async () => {
    const { ensureAppConfig, resetAppConfigForTests } = await import('../src/composables/useAppConfig')
    resetAppConfigForTests()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        imageEventsEnabled: true,
        canvasContextEnabled: true,
        imageCreditCostPerImage: 0.75,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await expect(ensureAppConfig()).resolves.toEqual({
      imageEventsEnabled: false,
      canvasContextEnabled: false,
      guestGenerationEnabled: true,
      imageCreditCostPerImage: 1,
      availableImageModels: [],
      defaultImageModel: '',
    })
    await expect(ensureAppConfig()).resolves.toEqual({
      imageEventsEnabled: true,
      canvasContextEnabled: true,
      guestGenerationEnabled: true,
      imageCreditCostPerImage: 0.75,
      availableImageModels: [],
      defaultImageModel: '',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
