import {
  ADMIN_USER_EMAILS,
  ADMIN_USER_IDS,
  CANVAS_CONTEXT_ENABLED,
  FREE_GENERATION_ENABLED,
  GUEST_GENERATION_ENABLED,
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
  | 'free_generation_enabled'
  | 'guest_generation_enabled'
  | 'available_image_models'

export type AdminRole = 'senior' | 'operator'

export interface ImageModelEntry {
  id: string
  name: string
}

export interface AppSettings {
  imageCreditCostPerImage: number
  imageAnalyticsEnabled: boolean
  imageResponsesModel: string
  imageResponsesImageModel: string
  imageEventsEnabled: boolean
  canvasContextEnabled: boolean
  freeGenerationEnabled: boolean
  guestGenerationEnabled: boolean
  availableImageModels: ImageModelEntry[]
}

export interface AdminUserRule {
  id: string
  userId: string | null
  email: string | null
  enabled: boolean
  note: string | null
  source: 'database' | 'env'
  role: AdminRole
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
  freeGenerationEnabled: FREE_GENERATION_ENABLED,
  guestGenerationEnabled: GUEST_GENERATION_ENABLED,
  availableImageModels: [],
}

const settingKeyToProperty: Record<AppSettingKey, keyof AppSettings> = {
  image_credit_cost_per_image: 'imageCreditCostPerImage',
  image_analytics_enabled: 'imageAnalyticsEnabled',
  image_responses_model: 'imageResponsesModel',
  image_responses_image_model: 'imageResponsesImageModel',
  image_events_enabled: 'imageEventsEnabled',
  canvas_context_enabled: 'canvasContextEnabled',
  free_generation_enabled: 'freeGenerationEnabled',
  guest_generation_enabled: 'guestGenerationEnabled',
  available_image_models: 'availableImageModels',
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
    role: 'senior',
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
    role: 'senior',
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

function normalizeImageModelList(value: unknown, fallback: ImageModelEntry[]): ImageModelEntry[] {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return fallback }
  }
  if (!Array.isArray(parsed)) return fallback
  const result: ImageModelEntry[] = []
  for (const item of parsed) {
    if (item == null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim()) continue
    result.push({
      id: record.id.trim(),
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : record.id.trim(),
    })
  }
  return result.length > 0 ? result : fallback
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

function lastAdminRuleError(error: unknown) {
  const text = [
    (error as any)?.message,
    (error as any)?.details,
    (error as any)?.hint,
  ].filter(Boolean).join(' ')
  return text.includes('last_admin_rule')
}

function lastAdminRuleAppError() {
  return new AppSettingsError('last_admin_rule', {
    publicMessage: '至少保留一个可用的后台管理员。',
  })
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
    } else if (property === 'imageAnalyticsEnabled' || property === 'imageEventsEnabled' || property === 'canvasContextEnabled' || property === 'freeGenerationEnabled' || property === 'guestGenerationEnabled') {
      settings[property] = normalizeBoolean(value, settings[property])
    } else if (property === 'imageResponsesModel' || property === 'imageResponsesImageModel') {
      settings[property] = normalizeModelName(value, settings[property])
    } else if (property === 'availableImageModels') {
      settings[property] = normalizeImageModelList(value, settings[property])
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
  if ('freeGenerationEnabled' in input) {
    next.freeGenerationEnabled = normalizeBoolean(input.freeGenerationEnabled, DEFAULT_APP_SETTINGS.freeGenerationEnabled)
  }
  if ('guestGenerationEnabled' in input) {
    next.guestGenerationEnabled = normalizeBoolean(input.guestGenerationEnabled, DEFAULT_APP_SETTINGS.guestGenerationEnabled)
  }
  if ('availableImageModels' in input) {
    const models = normalizeImageModelList(input.availableImageModels, [])
    if (!models.length) throw new AppSettingsError('invalid_available_image_models', {
      publicMessage: '至少需要一个可用的图像模型。',
    })
    next.availableImageModels = models
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
    role: 'operator',
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

export function envAdminRole(user: RequestUser | null): AdminRole | null {
  if (!user) return null
  const email = user.email?.toLowerCase() || null
  if (ADMIN_USER_IDS.includes(user.id)) return 'senior'
  if (email && ADMIN_USER_EMAILS.includes(email)) return 'senior'
  return null
}

export async function getAdminUserRole(user: RequestUser | null): Promise<AdminRole | null> {
  const envRole = envAdminRole(user)
  if (envRole) return envRole
  return await isConfiguredAdminUser(user) ? 'operator' : null
}

export async function assertSeniorAdminUser(user: RequestUser | null) {
  if (await getAdminUserRole(user) === 'senior') return user
  throw new AppSettingsError('senior_admin_required', {
    status: 403,
    publicMessage: '只有高级管理员可以设置后台管理员。',
  })
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
    throw lastAdminRuleAppError()
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
    value: Array.isArray(value) ? JSON.stringify(value) : value,
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
  const userId = rawUserId && isUuid(rawUserId) ? rawUserId : null
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
      role: 'operator',
      enabled: true,
      note: sanitizeNote(input.note),
      updated_at: now,
      updated_by: adminUser.id,
    })
    .select('id,user_id,email,enabled,note,role,created_at,updated_at')
    .maybeSingle()

  if (error) {
    if (lastAdminRuleError(error)) throw lastAdminRuleAppError()
    throw error
  }
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
    .select('id,user_id,email,enabled,note,role,created_at,updated_at')
    .maybeSingle()

  if (error) {
    if (lastAdminRuleError(error)) throw lastAdminRuleAppError()
    throw error
  }
  if (!data) throw new AppSettingsError('invalid_admin_rule_id')

  adminUsersCache = null
  return toAdminUserRule(data as Record<string, unknown>)
}

export async function publicAppConfig() {
  const settings = await getAppSettings()
  return {
    imageEventsEnabled: settings.imageEventsEnabled,
    canvasContextEnabled: settings.canvasContextEnabled,
    guestGenerationEnabled: settings.guestGenerationEnabled,
    imageCreditCostPerImage: settings.imageCreditCostPerImage,
    availableImageModels: settings.availableImageModels,
    defaultImageModel: settings.imageResponsesImageModel,
  }
}
