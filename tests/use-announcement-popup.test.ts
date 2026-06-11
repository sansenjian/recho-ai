import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

describe('useAnnouncementPopup', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows only the latest published announcement when it has not been read', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      announcements: [
        {
          id: 'old',
          title: 'Old',
          body: 'Old body',
          status: 'published',
          publishedAt: '2026-06-10T00:00:00.000Z',
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-10T00:00:00.000Z',
        },
        {
          id: 'latest',
          title: 'Latest',
          body: 'Latest body',
          status: 'published',
          publishedAt: '2026-06-11T00:00:00.000Z',
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const { useAnnouncementPopup } = await import('../src/composables/useAnnouncementPopup')

    const popup = useAnnouncementPopup()
    await popup.fetchLatestAnnouncement()

    expect(popup.announcement.value?.id).toBe('latest')
    expect(popup.shouldShowAnnouncement.value).toBe(true)
  })

  it('persists dismissed announcements and does not show them again', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      announcements: [{
        id: 'notice-1',
        title: 'Notice',
        body: 'Body',
        status: 'published',
        publishedAt: '2026-06-11T00:00:00.000Z',
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const { useAnnouncementPopup } = await import('../src/composables/useAnnouncementPopup')

    const first = useAnnouncementPopup()
    await first.fetchLatestAnnouncement()
    expect(first.shouldShowAnnouncement.value).toBe(true)

    first.markAnnouncementRead()
    await nextTick()
    expect(first.shouldShowAnnouncement.value).toBe(false)
    expect(localStorage.getItem('recho-read-announcements')).toContain('notice-1')

    const second = useAnnouncementPopup()
    await second.fetchLatestAnnouncement()
    expect(second.shouldShowAnnouncement.value).toBe(false)
  })
})
