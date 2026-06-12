import { computed, ref } from 'vue'
import { apiUrl } from '../lib/api-base'

const READ_STORAGE_KEY = 'recho-read-announcements'
const MAX_READ_IDS = 40
type ReadAnnouncementMap = Map<string, string>

export interface PublicAnnouncement {
  id: string
  title: string
  body: string
  status: 'published'
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

function announcementReadVersion(announcement: PublicAnnouncement) {
  return announcement.updatedAt || announcement.publishedAt || announcement.createdAt || ''
}

function safeReadIds(): ReadAnnouncementMap {
  if (typeof localStorage === 'undefined') return new Map<string, string>()
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY)
    const parsed = JSON.parse(raw || '{}')
    if (Array.isArray(parsed)) {
      return new Map(parsed
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map(id => [id, '']))
    }
    if (!parsed || typeof parsed !== 'object') return new Map<string, string>()
    const entries = Object.entries(parsed)
      .filter((entry): entry is [string, string] => {
        const [id, version] = entry
        return typeof id === 'string' && Boolean(id.trim()) && typeof version === 'string'
      })
    return new Map(entries)
  } catch {
    return new Map<string, string>()
  }
}

function persistReadIds(ids: ReadAnnouncementMap) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Object.fromEntries(Array.from(ids).slice(-MAX_READ_IDS))))
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
    const readVersion = item ? readIds.value.get(item.id) : undefined
    return Boolean(
      item &&
      readVersion !== announcementReadVersion(item) &&
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
    const current = announcement.value
    if (!id || !current) return
    const nextReadIds = new Map(readIds.value)
    nextReadIds.set(id, announcementReadVersion(current))
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
