import { computed } from 'vue'
import { getAuthAccessToken } from './useAuthSession'
import { ensureAppConfig, useAppConfig } from './useAppConfig'
import { apiUrl } from '../lib/api-base'

const IMAGE_EVENT_DEDUPE_MS = 2_000
const HIGH_FREQUENCY_IMAGE_EVENT_DEDUPE_MS = 5_000

export type ImageEventType =
  | 'view_detail'
  | 'zoom'
  | 'download'
  | 'continue_generate'
  | 'send_to_chat'
  | 'copy_prompt'
  | 'use_as_reference'
  | 'delete'

export type ImageEventSource =
  | 'works'
  | 'history'
  | 'canvas'
  | 'viewer'
  | 'chat'

export interface ImageEventPayload {
  imageId?: string
  eventType: ImageEventType
  source: ImageEventSource
  sessionId?: string
  metadata?: Record<string, string | number | boolean | null | undefined>
}

let sessionId: string | null = null
const recentEventTimes = new Map<string, number>()
const highFrequencyEventTypes = new Set<ImageEventType>(['zoom'])

function imageEventSessionId() {
  if (sessionId) return sessionId
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`
  sessionId = `image_session_${randomId}`
  return sessionId
}

function sanitizeMetadata(metadata: ImageEventPayload['metadata']) {
  if (!metadata) return undefined
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key, value]) => !key.toLowerCase().includes('prompt') && value !== undefined),
  )
}

function imageEventKey(payload: ImageEventPayload) {
  return [
    payload.eventType,
    payload.source,
    payload.imageId || 'image:none',
  ].join(':')
}

function shouldSkipRecentEvent(payload: ImageEventPayload) {
  const now = Date.now()
  const windowMs = highFrequencyEventTypes.has(payload.eventType)
    ? HIGH_FREQUENCY_IMAGE_EVENT_DEDUPE_MS
    : IMAGE_EVENT_DEDUPE_MS
  const key = imageEventKey(payload)
  const lastSentAt = recentEventTimes.get(key)

  if (lastSentAt && now - lastSentAt < windowMs) return true
  recentEventTimes.set(key, now)
  return false
}

export function useImageEvents() {
  const { imageEventsEnabled } = useAppConfig()

  async function recordImageEvent(payload: ImageEventPayload) {
    const appConfig = await ensureAppConfig()
    if (!appConfig.imageEventsEnabled) return false
    if (shouldSkipRecentEvent(payload)) return false

    try {
      const token = await getAuthAccessToken()
      const res = await fetch(apiUrl('/api/image/events'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...payload,
          sessionId: payload.sessionId || imageEventSessionId(),
          metadata: sanitizeMetadata(payload.metadata),
        }),
      })
      return res.ok
    } catch (err) {
      console.warn('[image-events] event skipped', err)
      return false
    }
  }

  return {
    enabled: computed(() => imageEventsEnabled.value),
    recordImageEvent,
  }
}
