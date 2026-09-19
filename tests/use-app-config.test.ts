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
        chatModels: [{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', provider: 'Custom Chat' }],
        imageEventsEnabled: true,
        canvasContextEnabled: true,
        imageCreditCostPerImage: 0.75,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await expect(ensureAppConfig()).resolves.toEqual({
      chatModels: [],
      imageEventsEnabled: false,
      canvasContextEnabled: false,
      guestGenerationEnabled: true,
      imageCreditCostPerImage: 1,
      imageModelCreditCosts: [],
      availableImageModels: [],
      defaultImageModel: '',
    })
    await expect(ensureAppConfig()).resolves.toEqual({
      chatModels: [{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', provider: 'Custom Chat' }],
      imageEventsEnabled: true,
      canvasContextEnabled: true,
      guestGenerationEnabled: true,
      imageCreditCostPerImage: 0.75,
      imageModelCreditCosts: [],
      availableImageModels: [],
      defaultImageModel: '',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps only well-formed per-model prices from the server config', async () => {
    const { ensureAppConfig, resetAppConfigForTests } = await import('../src/composables/useAppConfig')
    resetAppConfigForTests()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      imageCreditCostPerImage: 1,
      imageModelCreditCosts: [
        { id: 'gpt-image-2', cost: 3 },
        { id: 'flux-pro', cost: '1.5' },
        { id: 'zero', cost: 0 },
        { id: 'dup', cost: 2 },
        { id: 'dup', cost: 9 },
        { cost: 4 },
        null,
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const config = await ensureAppConfig()

    // 字符串价格、0 价、无 id 的行都被丢弃；重复 id 以第一条为准。
    expect(config.imageModelCreditCosts).toEqual([
      { id: 'gpt-image-2', cost: 3 },
      { id: 'dup', cost: 2 },
    ])
  })

  it('marks an empty server model list as loaded instead of falling back', async () => {
    const { ensureAppConfig, useAppConfig, resetAppConfigForTests } = await import('../src/composables/useAppConfig')
    resetAppConfigForTests()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ chatModels: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await ensureAppConfig()

    expect(useAppConfig().isLoaded.value).toBe(true)
    expect(useAppConfig().chatModels.value).toEqual([])
  })

  it('keeps the config unloaded after a failed request', async () => {
    const { ensureAppConfig, useAppConfig, resetAppConfigForTests } = await import('../src/composables/useAppConfig')
    resetAppConfigForTests()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))

    await ensureAppConfig()

    expect(useAppConfig().isLoaded.value).toBe(false)
  })
})
