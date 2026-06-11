import { getSupabaseAdminClient } from '../clients/supabase.js'
import { getAppSettings } from './app-settings.js'

const IMAGE_EVENTS_TABLE = 'image_events'
const IMAGE_CONTEXTS_TABLE = 'image_generation_contexts'
const IMAGE_EVENT_DEDUPE_MS = 2_000
const HIGH_FREQUENCY_IMAGE_EVENT_DEDUPE_MS = 5_000
const MAX_RECENT_EVENT_KEYS = 5_000

export const imageEventTypes = new Set([
  'view_detail',
  'zoom',
  'download',
  'continue_generate',
  'send_to_chat',
  'copy_prompt',
  'use_as_reference',
  'delete',
])

export const imageEventSources = new Set([
  'works',
  'history',
  'canvas',
  'viewer',
  'chat',
])

export interface ImageCanvasContext {
  canvasId: string
  nodeCount: number
  connectionCount: number
  imageNodeCount: number
  textNodeCount: number
  generationNodeCount: number
  referenceCount: number
  mentionedReferenceCount: number
  connectedReferenceCount: number
  promptCharCount: number
  hasConnectedPrompt: boolean
  canvasVersion: number
}

export interface ImageEventInput {
  imageId?: string | null
  userId?: string | null
  eventType: string
  source: string
  sessionId?: string | null
  metadata?: Record<string, unknown> | null
}

const recentEventTimes = new Map<string, number>()
const highFrequencyEventTypes = new Set(['zoom'])

export async function isImageAnalyticsEnabled(options: { enabled?: boolean } = {}) {
  if (typeof options.enabled === 'boolean') return options.enabled
  const settings = await getAppSettings()
  return settings.imageAnalyticsEnabled
}

function normalizedCount(value: unknown, max = 100_000) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(max, Math.round(value)))
}

function normalizedCanvasContext(value: unknown): ImageCanvasContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const context = value as Partial<ImageCanvasContext>
  const canvasId = typeof context.canvasId === 'string' ? context.canvasId.slice(0, 120) : ''
  if (!canvasId) return null

  return {
    canvasId,
    nodeCount: normalizedCount(context.nodeCount),
    connectionCount: normalizedCount(context.connectionCount),
    imageNodeCount: normalizedCount(context.imageNodeCount),
    textNodeCount: normalizedCount(context.textNodeCount),
    generationNodeCount: normalizedCount(context.generationNodeCount),
    referenceCount: normalizedCount(context.referenceCount),
    mentionedReferenceCount: normalizedCount(context.mentionedReferenceCount),
    connectedReferenceCount: normalizedCount(context.connectedReferenceCount),
    promptCharCount: normalizedCount(context.promptCharCount, 1_000_000),
    hasConnectedPrompt: Boolean(context.hasConnectedPrompt),
    canvasVersion: normalizedCount(context.canvasVersion, 100),
  }
}

function compactString(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, 160)
    : null
}

function imageEventDedupeKey(event: ImageEventInput) {
  return [
    event.userId || event.sessionId || 'anonymous',
    event.imageId || 'image:none',
    event.eventType,
    event.source,
  ].join(':')
}

function shouldSkipRecentImageEvent(event: ImageEventInput, now = Date.now()) {
  const windowMs = highFrequencyEventTypes.has(event.eventType)
    ? HIGH_FREQUENCY_IMAGE_EVENT_DEDUPE_MS
    : IMAGE_EVENT_DEDUPE_MS
  const key = imageEventDedupeKey(event)
  const lastSentAt = recentEventTimes.get(key)

  if (lastSentAt !== undefined && now - lastSentAt < windowMs) return true
  recentEventTimes.delete(key)
  recentEventTimes.set(key, now)
  pruneRecentEventTimes(now)

  return false
}

function pruneRecentEventTimes(now = Date.now()) {
  if (recentEventTimes.size <= MAX_RECENT_EVENT_KEYS) return

  const staleBefore = now - HIGH_FREQUENCY_IMAGE_EVENT_DEDUPE_MS
  for (const [recentKey, sentAt] of recentEventTimes) {
    if (sentAt < staleBefore) recentEventTimes.delete(recentKey)
    if (recentEventTimes.size <= MAX_RECENT_EVENT_KEYS) return
  }

  for (const recentKey of recentEventTimes.keys()) {
    recentEventTimes.delete(recentKey)
    if (recentEventTimes.size <= MAX_RECENT_EVENT_KEYS) return
  }
}

export function sanitizeImageEventMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const metadata = value as Record<string, unknown>
  const safe: Record<string, string | number | boolean | null> = {}

  for (const [key, rawValue] of Object.entries(metadata)) {
    if (key.toLowerCase().includes('prompt')) continue
    if (!/^[a-zA-Z0-9_:-]{1,40}$/.test(key)) continue
    if (typeof rawValue === 'boolean') safe[key] = rawValue
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) safe[key] = Math.round(rawValue)
    else if (rawValue === null) safe[key] = null
    else {
      const compact = compactString(rawValue)
      if (compact) safe[key] = compact
    }
  }

  return Object.keys(safe).length ? safe : null
}

export async function recordImageEvent(event: ImageEventInput, options: { enabled?: boolean } = {}) {
  if (!await isImageAnalyticsEnabled(options)) return false
  const client = getSupabaseAdminClient()
  if (!client) return false
  if (!imageEventTypes.has(event.eventType) || !imageEventSources.has(event.source)) return false
  if (shouldSkipRecentImageEvent(event)) return false

  const { error } = await client
    .from(IMAGE_EVENTS_TABLE)
    .insert({
      image_id: event.imageId || null,
      user_id: event.userId || null,
      event_type: event.eventType,
      source: event.source,
      session_id: event.sessionId || null,
      metadata: sanitizeImageEventMetadata(event.metadata),
    })

  if (error) {
    console.warn('[image-events] record skipped:', error.message)
    return false
  }
  return true
}

export async function recordImageGenerationContext(
  generationId: string,
  userId: string | null,
  rawContext: unknown,
  options: { enabled?: boolean } = {},
) {
  if (!await isImageAnalyticsEnabled(options)) return false
  const context = normalizedCanvasContext(rawContext)
  if (!context) return false
  const client = getSupabaseAdminClient()
  if (!client) return false

  const { error } = await client
    .from(IMAGE_CONTEXTS_TABLE)
    .insert({
      generation_id: generationId,
      user_id: userId || null,
      canvas_id: context.canvasId,
      node_count: context.nodeCount,
      connection_count: context.connectionCount,
      image_node_count: context.imageNodeCount,
      text_node_count: context.textNodeCount,
      generation_node_count: context.generationNodeCount,
      reference_count: context.referenceCount,
      mentioned_reference_count: context.mentionedReferenceCount,
      connected_reference_count: context.connectedReferenceCount,
      prompt_char_count: context.promptCharCount,
      has_connected_prompt: context.hasConnectedPrompt,
      canvas_version: context.canvasVersion,
    })

  if (error) {
    console.warn('[image-contexts] record skipped:', error.message)
    return false
  }
  return true
}
