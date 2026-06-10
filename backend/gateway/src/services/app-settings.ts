import {
  ADMIN_USER_EMAILS,
  ADMIN_USER_IDS,
  CANVAS_CONTEXT_ENABLED,
  IMAGE_ANALYTICS_ENABLED,
  IMAGE_CREDIT_COST_PER_IMAGE,
  IMAGE_EVENTS_ENABLED,
  IMAGE_RESPONSES_IMAGE_MODEL,
  IMAGE_RESPONSES_MODEL,
} from '../config.js'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { normalizeImageCreditCostPerImage } from './image-credit-cost.js'
import { safeErrorDetail } from './safe-error.js'
import type { RequestUser } from './request-auth.js'

const APP_SETTINGS_TABLE = 'app_settings'
const ADMIN_USERS_TABLE = 'admin_users'
const SETTINGS_CACHE_MS = 15_000
const SETTINGS_FALLBACK_CACHE_MS = 10_000
const ADMIN_USERS_CACHE_MS = 15_000

type AppSettingKey =
  | 'image_credit_cost_per_image'
  | 'image_analytics_enabled'
  | 'image_responses_model'
  | 'image_responses_image_model'
  | 'image_events_enabled'
  | 'canvas_context_enabled'

export interface AppSettings {
  imageCreditCostPerImage: number
  imageAnalyticsEnabled: boolean
  imageResponsesModel: string
  imageResponsesImageModel: string
  imageEventsEnabled: boolean
  canvasContextEnabled: boolean
}

export interface AdminUserRule {
  id: string
  userId: string | null
  email: string | null
  enabled: boolean
  note: string | null
  source: 'database' | 'env'
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminAccessSummary {
  configured: boolean
  userIdCount: number
  emailCount: number
  databaseCount: number
  envUserIdCount: number
  envEmailCount: number
  tableAvailable: boolean
}

export class AppSettingsError extends Error {
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.status = options.status ?? 400
    this.publicMessage = options.publicMessage ?? '配置保存失败，请检查输入。'
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  imageCreditCostPerImage: IMAGE_CREDIT_COST_PER_IMAGE,
  imageAnalyticsEnabled: IMAGE_ANALYTICS_ENABLED,
  imageResponsesModel: IMAGE_RESPONSES_MODEL,
  imageResponsesImageModel: IMAGE_RESPONSES_IMAGE_MODEL,
  imageEventsEnabled: IMAGE_EVENTS_ENABLED,
  canvasContextEnabled: CANVAS_CONTEXT_ENABLED,
}

const settingKeyToProperty: Record<AppSettingKey, keyof AppSettings> = {
  image_credit_cost_per_image: 'imageCreditCostPerImage',
  image_analytics_enabled: 'imageAnalyticsEnabled',
  image_responses_model: 'imageResponsesModel',
  image_responses_image_model: 'imageResponsesImageModel',
  image_events_enabled: 'imageEventsEnabled',
  canvas_context_enabled: 'canvasContextEnabled',
}

const propertyToSettingKey = Object.fromEntries(
  Object.entries(settingKeyToProperty).map(([key, property]) => [property, key]),
) as Record<keyof AppSettings, AppSettingKey>

let settingsCache: { expiresAt: number; settings: AppSettings } | null = null
let adminUsersCache: {
  expiresAt: number
  databaseRules: AdminUserRule[]
  tableAvailable: boolean
} | null = null

function envAdminRules(): AdminUserRule[] {
  const userIdRules = ADMIN_USER_IDS.map((userId): AdminUserRule => ({
    id: `env:user:${userId}`,
    userId,
    email: null,
    enabled: true,
    note: null,
    source: 'env',
    createdAt: null,
    updatedAt: null,
  }))

  const emailRules = ADMIN_USER_EMAILS.map((email): AdminUserRule => ({
    id: `env:email:${email}`,
    userId: null,
    email,
    enabled: true,
    note: null,
    source: 'env',
    createdAt: null,
    updatedAt: null,
  }))

  return [...userIdRules, ...emailRules]
}

function cacheFallbackAppSettings(now = Date.now()) {
  const settings = { ...DEFAULT_APP_SETTINGS }
  settingsCache = { settings, expiresAt: now + SETTINGS_FALLBACK_CACHE_MS }
  return settings
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return fallback
}

function normalizeModelName(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  const model = value.trim()
  if (!model || model.length > 120) return fallback
  return /^[a-zA-Z0-9._:/-]+$/.test(model) ? model : fallback
}

function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function sanitizeNote(value: unknown) {
  if (typeof value !== 'string') return null
  const note = value.trim()
  return note ? note.slice(0, 240) : null
}

function appSettingsFromRows(rows: Array<Record<string, unknown>>): AppSettings {
  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS }

  for (const row of rows) {
    const key = String(row.key || '') as AppSettingKey
    const property = settingKeyToProperty[key]
    if (!property) continue
    const value = row.value

    if (property === 'imageCreditCostPerImage') {
      settings[property] = normalizeImageCreditCostPerImage(value)
    } else if (property === 'imageAnalyticsEnabled' || property === 'imageEventsEnabled' || property === 'canvasContextEnabled') {
      settings[property] = normalizeBoolean(value, settings[property])
    } else if (property === 'imageResponsesModel' || property === 'imageResponsesImageModel') {
      settings[property] = normalizeModelName(value, settings[property])
    }
  }

  return settings
}

function validateAppSettingsUpdate(input: Record<string, unknown>): Partial<AppSettings> {
  const next: Partial<AppSettings> = {}

  if ('imageCreditCostPerImage' in input) {
    next.imageCreditCostPerImage = normalizeImageCreditCostPerImage(input.imageCreditCostPerImage)
  }
  if ('imageAnalyticsEnabled' in input) {
    next.imageAnalyticsEnabled = normalizeBoolean(input.imageAnalyticsEnabled, DEFAULT_APP_SETTINGS.imageAnalyticsEnabled)
  }
  if ('imageResponsesModel' in input) {
    const model = normalizeModelName(input.imageResponsesModel, '')
    if (!model) throw new AppSettingsError('invalid_image_responses_model')
    next.imageResponsesModel = model
  }
  if ('imageResponsesImageModel' in input) {
    const model = normalizeModelName(input.imageResponsesImageModel, '')
    if (!model) throw new AppSettingsError('invalid_image_responses_image_model')
    next.imageResponsesImageModel = model
  }
  if ('imageEventsEnabled' in input) {
    next.imageEventsEnabled = normalizeBoolean(input.imageEventsEnabled, DEFAULT_APP_SETTINGS.imageEventsEnabled)
  }
  if ('canvasContextEnabled' in input) {
    next.canvasContextEnabled = normalizeBoolean(input.canvasContextEnabled, DEFAULT_APP_SETTINGS.canvasContextEnabled)
  }

  return next
}

function toAdminUserRule(row: Record<string, unknown>): AdminUserRule {
  return {
    id: String(row.id || ''),
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    email: typeof row.email === 'string' ? row.email : null,
    enabled: row.enabled !== false,
    note: typeof row.note === 'string' && row.note ? row.note : null,
    source: 'database',
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

export function clearAppSettingsCache() {
  settingsCache = null
  adminUsersCache = null
}

export async function getAppSettings(options: { refresh?: boolean } = {}): Promise<AppSettings> {
  const now = Date.now()
  if (!options.refresh && settingsCache && settingsCache.expiresAt > now) return settingsCache.settings

  const client = getSupabaseAdminClient()
  if (!client) return cacheFallbackAppSettings(now)

  try {
    const { data, error } = await client
      .from(APP_SETTINGS_TABLE)
      .select('key,value')

    if (error) throw error
    const rows = (data || []) as Array<Record<string, unknown>>
    const settings = appSettingsFromRows(rows)
    settingsCache = { settings, expiresAt: now + SETTINGS_CACHE_MS }
    return settings
  } catch (err) {
    console.warn('[app-settings] using env fallback:', safeErrorDetail(err))
    return cacheFallbackAppSettings(now)
  }
}

async function loadDatabaseAdminRules(options: { refresh?: boolean } = {}) {
  const now = Date.now()
  if (!options.refresh && adminUsersCache && adminUsersCache.expiresAt > now) return adminUsersCache

  const client = getSupabaseAdminClient()
  if (!client) {
    return {
      expiresAt: now + ADMIN_USERS_CACHE_MS,
      databaseRules: [],
      tableAvailable: false,
    }
  }

  try {
    const { data, error } = await client
      .from(ADMIN_USERS_TABLE)
      .select('id,user_id,email,enabled,note,created_at,updated_at')
      .order('updated_at', { ascending: false })

    if (error) throw error
    const cache = {
      expiresAt: now + ADMIN_USERS_CACHE_MS,
      databaseRules: ((data || []) as Array<Record<string, unknown>>).map(toAdminUserRule),
      tableAvailable: true,
    }
    adminUsersCache = cache
    return cache
  } catch (err) {
    console.warn('[admin-users] using env fallback:', safeErrorDetail(err))
    const cache = {
      expiresAt: now + ADMIN_USERS_CACHE_MS,
      databaseRules: [],
      tableAvailable: false,
    }
    adminUsersCache = cache
    return cache
  }
}

export async function getAdminUserRules(options: { refresh?: boolean } = {}) {
  const database = await loadDatabaseAdminRules(options)
  return [...database.databaseRules, ...envAdminRules()]
}

export async function getAdminAccessSummary(options: { refresh?: boolean } = {}): Promise<AdminAccessSummary> {
  const database = await loadDatabaseAdminRules(options)
  const enabledDbRules = database.databaseRules.filter(rule => rule.enabled)
  const envRules = envAdminRules()
  const enabledRules = [...enabledDbRules, ...envRules]
  const userIds = new Set(enabledRules.map(rule => rule.userId).filter(Boolean))
  const emails = new Set(enabledRules.map(rule => rule.email).filter(Boolean))

  return {
    configured: Boolean(userIds.size || emails.size),
    userIdCount: userIds.size,
    emailCount: emails.size,
    databaseCount: enabledDbRules.length,
    envUserIdCount: ADMIN_USER_IDS.length,
    envEmailCount: ADMIN_USER_EMAILS.length,
    tableAvailable: database.tableAvailable,
  }
}

export async function isConfiguredAdminUser(user: RequestUser | null): Promise<boolean> {
  if (!user) return false
  const email = user.email?.toLowerCase() || null
  if (ADMIN_USER_IDS.includes(user.id)) return true
  if (email && ADMIN_USER_EMAILS.includes(email)) return true

  const database = await loadDatabaseAdminRules()
  return database.databaseRules.some(rule => (
    rule.enabled &&
    ((rule.userId && rule.userId === user.id) || (email && rule.email === email))
  ))
}

function hasRemainingEnabledAdminRule(rules: AdminUserRule[], disabledRuleId: string) {
  const remainingRules = [
    ...rules.filter(rule => rule.enabled && rule.id !== disabledRuleId),
    ...envAdminRules(),
  ]
  return remainingRules.some(rule => Boolean(rule.userId || rule.email))
}

async function assertCanDisableAdminUserRule(ruleId: string) {
  const database = await loadDatabaseAdminRules({ refresh: true })
  const rule = database.databaseRules.find(item => item.id === ruleId)
  if (!rule || !rule.enabled) return

  if (!hasRemainingEnabledAdminRule(database.databaseRules, ruleId)) {
    throw new AppSettingsError('last_admin_rule', {
      publicMessage: '至少保留一个可用的后台管理员。',
    })
  }
}

export async function updateAppSettings(input: Record<string, unknown>, adminUser: RequestUser): Promise<AppSettings> {
  const updates = validateAppSettingsUpdate(input)
  const entries = Object.entries(updates) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>
  if (!entries.length) return await getAppSettings({ refresh: true })

  const client = getSupabaseAdminClient()
  if (!client) throw new AppSettingsError('settings_service_unavailable', {
    status: 503,
    publicMessage: '配置服务暂时不可用。',
  })

  const updatedAt = new Date().toISOString()
  const rows = entries.map(([property, value]) => ({
    key: propertyToSettingKey[property],
    value,
    updated_at: updatedAt,
    updated_by: adminUser.id,
  }))

  const { error } = await client
    .from(APP_SETTINGS_TABLE)
    .upsert(rows, { onConflict: 'key' })
  if (error) throw error

  settingsCache = null
  return await getAppSettings({ refresh: true })
}

export async function createAdminUserRule(input: Record<string, unknown>, adminUser: RequestUser) {
  const rawUserId = typeof input.userId === 'string' ? input.userId.trim() : ''
  const rawEmail = typeof input.email === 'string' ? input.email.trim() : ''
  const userId = rawUserId ? isUuid(rawUserId) ? rawUserId : null : null
  const email = rawEmail ? normalizeEmail(rawEmail) : null
  if (rawUserId && !userId) throw new AppSettingsError('invalid_admin_identity', {
    publicMessage: '请输入有效的用户 ID 或邮箱。',
  })
  if (rawEmail && !email) throw new AppSettingsError('invalid_admin_identity', {
    publicMessage: '请输入有效的用户 ID 或邮箱。',
  })
  if (!userId && !email) throw new AppSettingsError('invalid_admin_identity', {
    publicMessage: '请输入有效的用户 ID 或邮箱。',
  })

  const client = getSupabaseAdminClient()
  if (!client) throw new AppSettingsError('settings_service_unavailable', {
    status: 503,
    publicMessage: '配置服务暂时不可用。',
  })

  const now = new Date().toISOString()
  const { data, error } = await client
    .from(ADMIN_USERS_TABLE)
    .insert({
      user_id: userId,
      email,
      enabled: true,
      note: sanitizeNote(input.note),
      updated_at: now,
      updated_by: adminUser.id,
    })
    .select('id,user_id,email,enabled,note,created_at,updated_at')
    .maybeSingle()

  if (error) throw error
  adminUsersCache = null
  return toAdminUserRule(data as Record<string, unknown>)
}

export async function updateAdminUserRule(ruleId: string, input: Record<string, unknown>, adminUser: RequestUser) {
  if (!isUuid(ruleId)) throw new AppSettingsError('invalid_admin_rule_id')

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: adminUser.id,
  }
  if ('enabled' in input) {
    const enabled = normalizeBoolean(input.enabled, true)
    if (!enabled) await assertCanDisableAdminUserRule(ruleId)
    patch.enabled = enabled
  }
  if ('note' in input) patch.note = sanitizeNote(input.note)

  const client = getSupabaseAdminClient()
  if (!client) throw new AppSettingsError('settings_service_unavailable', {
    status: 503,
    publicMessage: '配置服务暂时不可用。',
  })

  const { data, error } = await client
    .from(ADMIN_USERS_TABLE)
    .update(patch)
    .eq('id', ruleId)
    .select('id,user_id,email,enabled,note,created_at,updated_at')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new AppSettingsError('invalid_admin_rule_id')

  adminUsersCache = null
  return toAdminUserRule(data as Record<string, unknown>)
}

export async function publicAppConfig() {
  const settings = await getAppSettings()
  return {
    imageEventsEnabled: settings.imageEventsEnabled,
    canvasContextEnabled: settings.canvasContextEnabled,
  }
}
