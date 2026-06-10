import type { User } from '@supabase/supabase-js'

const ADMIN_USER_CACHE_TTL_MS = 30_000
const ADMIN_USER_CACHE_MAX = 2_000

export interface AdminUserSummary {
  id: string
  email: string | null
}

interface AdminUserClient {
  auth: {
    admin: {
      getUserById: (userId: string) => Promise<{
        data: { user: User | null }
        error: unknown
      }>
    }
  }
}

const userCache = new Map<string, { user: AdminUserSummary | null; expiresAt: number }>()

function toAdminUserSummary(user: User): AdminUserSummary {
  return {
    id: user.id,
    email: user.email || null,
  }
}

function pruneUserCache(now = Date.now()) {
  for (const [userId, cached] of userCache) {
    if (cached.expiresAt <= now) userCache.delete(userId)
    if (userCache.size <= ADMIN_USER_CACHE_MAX) return
  }

  for (const userId of userCache.keys()) {
    userCache.delete(userId)
    if (userCache.size <= ADMIN_USER_CACHE_MAX) return
  }
}

function getCachedUser(userId: string, now = Date.now()) {
  const cached = userCache.get(userId)
  if (!cached) return null
  if (cached.expiresAt <= now) {
    userCache.delete(userId)
    return null
  }

  userCache.delete(userId)
  userCache.set(userId, cached)
  return cached
}

function setCachedUser(userId: string, cached: { user: AdminUserSummary | null; expiresAt: number }, now = Date.now()) {
  userCache.delete(userId)
  userCache.set(userId, cached)
  pruneUserCache(now)
}

export function clearAdminUserCache() {
  userCache.clear()
}

export async function cachedAdminUsersById(client: AdminUserClient, userIds: string[]) {
  const now = Date.now()
  const users = new Map<string, AdminUserSummary>()
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)))
  const misses: string[] = []

  for (const userId of uniqueUserIds) {
    const cached = getCachedUser(userId, now)
    if (cached) {
      if (cached.user) users.set(userId, cached.user)
      continue
    }
    misses.push(userId)
  }

  await Promise.all(misses.map(async userId => {
    const { data, error } = await client.auth.admin.getUserById(userId)
    const user = !error && data.user ? toAdminUserSummary(data.user) : null
    setCachedUser(userId, { user, expiresAt: now + ADMIN_USER_CACHE_TTL_MS }, now)
    if (user) users.set(userId, user)
  }))
  return users
}
