import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertMock = vi.fn()

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}))

describe('image analytics guardrails', () => {
  beforeEach(() => {
    insertMock.mockResolvedValue({ error: null })
    insertMock.mockClear()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('keeps image event recording disabled by default', async () => {
    const { recordImageEvent } = await import('../backend/gateway/src/services/image-analytics')

    await expect(recordImageEvent({
      eventType: 'download',
      source: 'canvas',
      imageId: 'img_1',
    })).resolves.toBe(false)
  })

  it('drops prompt-like fields from event metadata', async () => {
    const { sanitizeImageEventMetadata } = await import('../backend/gateway/src/services/image-analytics')

    expect(sanitizeImageEventMetadata({
      prompt: 'full user prompt',
      modelPrompt: 'full model prompt',
      action: 'download',
      zoom: 2,
      ok: true,
    })).toEqual({
      action: 'download',
      zoom: 2,
      ok: true,
    })
  })

  it('deduplicates repeated high-frequency image events', async () => {
    const { recordImageEvent } = await import('../backend/gateway/src/services/image-analytics')
    const event = {
      eventType: 'zoom',
      source: 'canvas',
      imageId: 'img_2',
      sessionId: 'session_1',
    }

    await expect(recordImageEvent(event, { enabled: true })).resolves.toBe(true)
    await expect(recordImageEvent(event, { enabled: true })).resolves.toBe(false)
    expect(insertMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the image event dedupe cache bounded under unique-event bursts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'))
    const { recordImageEvent } = await import('../backend/gateway/src/services/image-analytics')

    for (let index = 0; index < 5_010; index += 1) {
      await recordImageEvent({
        eventType: 'download',
        source: 'canvas',
        imageId: `img_${index}`,
        sessionId: 'session_1',
      }, { enabled: true })
    }

    await expect(recordImageEvent({
      eventType: 'download',
      source: 'canvas',
      imageId: 'img_0',
      sessionId: 'session_1',
    }, { enabled: true })).resolves.toBe(true)
    expect(insertMock).toHaveBeenCalledTimes(5_011)
  })
})
