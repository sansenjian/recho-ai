import { computed, ref } from 'vue'
import { apiUrl } from '../lib/api-base'

const READ_STORAGE_KEY = 'recho-read-announcements'
const MAX_READ_IDS = 40

export interface PublicAnnouncement {
  id: string
  title: string
  body: string
  status: 'published'
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

function safeReadIds() {
  if (typeof localStorage === 'undefined') return new Set<string>()
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY)
    const ids = JSON.parse(raw || '[]')
    if (!Array.isArray(ids)) return new Set<string>()
    return new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
  } catch {
    return new Set<string>()
  }
}

function persistReadIds(ids: Set<string>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(-MAX_READ_IDS)))
  } catch {
    // Ignore storage failures; the announcement can be dismissed for this session.
  }
}

function announcementTime(announcement: PublicAnnouncement) {
  const value = announcement.publishedAt || announcement.updatedAt || announcement.createdAt || ''
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function latestPublishedAnnouncement(items: PublicAnnouncement[]) {
  return items
    .filter(item => item.status === 'published' && item.id)
    .sort((left, right) => announcementTime(right) - announcementTime(left))[0] || null
}

export function useAnnouncementPopup() {
  const announcement = ref<PublicAnnouncement | null>(null)
  const readIds = ref(safeReadIds())
  const dismissedSessionIds = ref(new Set<string>())

  const shouldShowAnnouncement = computed(() => {
    const item = announcement.value
    return Boolean(
      item &&
      !readIds.value.has(item.id) &&
      !dismissedSessionIds.value.has(item.id),
    )
  })

  async function fetchLatestAnnouncement() {
    try {
      const response = await fetch(apiUrl('/api/announcements?limit=5'))
      if (!response.ok) return
      const data = await response.json() as { announcements?: PublicAnnouncement[] }
      announcement.value = latestPublishedAnnouncement(data.announcements || [])
    } catch {
      // Announcements are optional UI; never block the app shell.
    }
  }

  function markAnnouncementRead(id = announcement.value?.id) {
    if (!id) return
    const nextReadIds = new Set(readIds.value)
    nextReadIds.add(id)
    readIds.value = nextReadIds
    persistReadIds(nextReadIds)

    const nextDismissedIds = new Set(dismissedSessionIds.value)
    nextDismissedIds.add(id)
    dismissedSessionIds.value = nextDismissedIds
  }

  return {
    announcement,
    shouldShowAnnouncement,
    fetchLatestAnnouncement,
    markAnnouncementRead,
  }
}
