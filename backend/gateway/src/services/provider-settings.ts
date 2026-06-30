import { getSupabaseAdminClient } from '../clients/supabase.js'
import {
  IMAGE_GEN_API_KEY,
  IMAGE_GEN_BASE_URL,
  IMAGE_RESPONSES_IMAGE_MODEL,
  KIMI_API_KEY,
  KIMI_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
} from '../config.js'
import type { RequestUser } from './request-auth.js'
import { safeErrorDetail } from './safe-error.js'
import {
  SecretCryptoError,
  decryptSecret,
  encryptSecret,
  publicSecretCryptoError,
} from './secret-crypto.js'

const PROVIDER_SETTINGS_TABLE = 'provider_settings'
const PROVIDER_SETTINGS_CACHE_MS = 15_000

export type ProviderKind = 'chat' | 'image'

export interface ProviderSetting {
  id: string
  kind: ProviderKind
  name: string
  baseUrl: string
  enabled: boolean
  priority: number
  defaultModel: string | null
  imageModel: string | null
  editModel: string | null
  timeoutMs: number
  retryCount: number
  supportsWebpReferences: boolean
  notes: string | null
  apiKeyConfigured: boolean
  apiKeyPreview: string | null
  source: 'database' | 'env'
  createdAt: string | null
  updatedAt: string | null
}

export interface RuntimeChatProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  defaultModel: string | null
  timeoutMs: number
  retryCount: number
  source: 'database'
}

export class ProviderSettingsError extends Error {
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.status = options.status ?? 400
    this.publicMessage = options.publicMessage ?? 'Provider 配置保存失败，请检查输入。'
  }
}

function providerSettingsErrorFromSecretCrypto(error: unknown) {
  if (!(error instanceof SecretCryptoError)) throw error
  return new ProviderSettingsError(error.message, {
    status: error.message.includes('invalid') ? 400 : 503,
    publicMessage: publicSecretCryptoError(error),
  })
}

let providerSettingsCache: {
  expiresAt: number
  providers: ProviderSetting[]
  tableAvailable: boolean
} | null = null

function normalizeKind(value: unknown): ProviderKind {
  if (value === 'chat' || value === 'image') return value
  throw new ProviderSettingsError('invalid_provider_kind', {
    publicMessage: 'Provider 类型必须是 chat 或 image。',
  })
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength)
}

function nullableText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength)
  return text || null
}

function normalizeName(value: unknown) {
  const name = cleanText(value, 80)
  if (!name) throw new ProviderSettingsError('invalid_provider_name', {
    publicMessage: 'Provider 名称不能为空。',
  })
  return name
}

function normalizeBaseUrl(value: unknown) {
  const input = cleanText(value, 240).replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new ProviderSettingsError('invalid_provider_base_url', {
      publicMessage: 'Base URL 必须是合法的 http(s) 地址。',
    })
  }
  const hostname = parsed.hostname.toLowerCase()
  const isLocalHttp = parsed.protocol === 'http:' && (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
  if (parsed.protocol !== 'https:' && !isLocalHttp) {
    throw new ProviderSettingsError('invalid_provider_base_url', {
      publicMessage: 'Base URL 必须使用 HTTPS，本地开发可使用 localhost 或 127.0.0.1 的 HTTP 地址。',
    })
  }
  return parsed.toString().replace(/\/+$/, '')
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return fallback
}

function maskApiKey(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const key = value.trim()
  if (key.length <= 8) return '********'
  return `${key.slice(0, 3)}...${key.slice(-4)}`
}

function envProviderRows(): ProviderSetting[] {
  const providers: ProviderSetting[] = []
  if (IMAGE_GEN_API_KEY && IMAGE_GEN_BASE_URL) {
    providers.push({
      id: 'env:image',
      kind: 'image',
      name: 'Env image provider',
      baseUrl: IMAGE_GEN_BASE_URL.replace(/\/+$/, ''),
      enabled: true,
      priority: 10_000,
      defaultModel: null,
      imageModel: IMAGE_RESPONSES_IMAGE_MODEL,
      editModel: IMAGE_RESPONSES_IMAGE_MODEL,
      timeoutMs: 360_000,
      retryCount: 3,
      supportsWebpReferences: true,
      notes: null,
      apiKeyConfigured: true,
      apiKeyPreview: maskApiKey(IMAGE_GEN_API_KEY),
      source: 'env',
      createdAt: null,
      updatedAt: null,
    })
  }
  if (OPENAI_API_KEY && OPENAI_BASE_URL) {
    providers.push({
      id: 'env:chat:openai',
      kind: 'chat',
      name: 'Env OpenAI provider',
      baseUrl: OPENAI_BASE_URL.replace(/\/+$/, ''),
      enabled: true,
      priority: 10_000,
      defaultModel: 'gpt-4o-mini',
      imageModel: null,
      editModel: null,
      timeoutMs: 60_000,
      retryCount: 3,
      supportsWebpReferences: false,
      notes: null,
      apiKeyConfigured: true,
      apiKeyPreview: maskApiKey(OPENAI_API_KEY),
      source: 'env',
      createdAt: null,
      updatedAt: null,
    })
  }
  if (KIMI_API_KEY && KIMI_BASE_URL) {
    providers.push({
      id: 'env:chat:kimi',
      kind: 'chat',
      name: 'Env Kimi provider',
      baseUrl: KIMI_BASE_URL.replace(/\/+$/, ''),
      enabled: true,
      priority: 10_001,
      defaultModel: 'kimi-k2-0711-preview',
      imageModel: null,
      editModel: null,
      timeoutMs: 60_000,
      retryCount: 3,
      supportsWebpReferences: false,
      notes: null,
      apiKeyConfigured: true,
      apiKeyPreview: maskApiKey(KIMI_API_KEY),
      source: 'env',
      createdAt: null,
      updatedAt: null,
    })
  }
  return providers
}

function providerFromRow(row: Record<string, unknown>): ProviderSetting {
  const apiKeyPreview = typeof row.api_key_preview === 'string' && row.api_key_preview
    ? row.api_key_preview
    : null
  const encryptedKey = typeof row.api_key_encrypted === 'string' && row.api_key_encrypted.trim()
  return {
    id: String(row.id || ''),
    kind: row.kind === 'chat' ? 'chat' : 'image',
    name: String(row.name || ''),
    baseUrl: String(row.base_url || '').replace(/\/+$/, ''),
    enabled: row.enabled === true,
    priority: normalizeInt(row.priority, 100, 0, 10_000),
    defaultModel: typeof row.default_model === 'string' && row.default_model ? row.default_model : null,
    imageModel: typeof row.image_model === 'string' && row.image_model ? row.image_model : null,
    editModel: typeof row.edit_model === 'string' && row.edit_model ? row.edit_model : null,
    timeoutMs: normalizeInt(row.timeout_ms, 360_000, 1_000, 1_200_000),
    retryCount: normalizeInt(row.retry_count, 3, 0, 10),
    supportsWebpReferences: row.supports_webp_references !== false,
    notes: typeof row.notes === 'string' && row.notes ? row.notes : null,
    apiKeyConfigured: Boolean(encryptedKey),
    apiKeyPreview,
    source: 'database',
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

function runtimeChatProviderFromRow(row: Record<string, unknown>): RuntimeChatProvider | null {
  let apiKey = ''
  const encryptedKey = typeof row.api_key_encrypted === 'string' ? row.api_key_encrypted.trim() : ''
  if (encryptedKey) {
    apiKey = decryptSecret(encryptedKey)
  }
  const baseUrl = typeof row.base_url === 'string' ? row.base_url.trim().replace(/\/+$/, '') : ''
  if (!apiKey || !baseUrl) return null
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    baseUrl,
    apiKey,
    defaultModel: typeof row.default_model === 'string' && row.default_model.trim()
      ? row.default_model.trim()
      : null,
    timeoutMs: normalizeInt(row.timeout_ms, 60_000, 1_000, 1_200_000),
    retryCount: normalizeInt(row.retry_count, 3, 0, 10),
    source: 'database',
  }
}

function rowDefaultModel(row: Record<string, unknown>) {
  return typeof row.default_model === 'string' ? row.default_model.trim() : ''
}

function chatProviderFamily(model: string) {
  const normalized = model.trim().toLowerCase()
  if (normalized.startsWith('gpt-')) return 'openai:gpt'
  if (normalized.startsWith('moonshot') || normalized.startsWith('kimi-')) return 'kimi'
  const slashIndex = normalized.indexOf('/')
  if (slashIndex > 0) return `slash:${normalized.slice(0, slashIndex)}`
  return `exact:${normalized}`
}

function chatProviderMatchesModelName(configuredModel: string | null | undefined, model: string) {
  if (!configuredModel) return false
  if (configuredModel === model) return true
  return chatProviderFamily(configuredModel) === chatProviderFamily(model)
}

function validateProviderInput(input: Record<string, unknown>, options: { partial?: boolean } = {}) {
  const patch: Record<string, unknown> = {}

  if (!options.partial || 'kind' in input) patch.kind = normalizeKind(input.kind)
  if (!options.partial || 'name' in input) patch.name = normalizeName(input.name)
  if (!options.partial || 'baseUrl' in input) patch.base_url = normalizeBaseUrl(input.baseUrl)
  if ('enabled' in input) patch.enabled = normalizeBoolean(input.enabled)
  if ('priority' in input) patch.priority = normalizeInt(input.priority, 100, 0, 10_000)
  if ('defaultModel' in input) patch.default_model = nullableText(input.defaultModel, 120)
  if ('imageModel' in input) patch.image_model = nullableText(input.imageModel, 120)
  if ('editModel' in input) patch.edit_model = nullableText(input.editModel, 120)
  if ('timeoutMs' in input) patch.timeout_ms = normalizeInt(input.timeoutMs, 360_000, 1_000, 1_200_000)
  if ('retryCount' in input) patch.retry_count = normalizeInt(input.retryCount, 3, 0, 10)
  if ('supportsWebpReferences' in input) patch.supports_webp_references = normalizeBoolean(input.supportsWebpReferences, true)
  if ('notes' in input) patch.notes = nullableText(input.notes, 500)

  if ('apiKey' in input) {
    const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    if (key) {
      try {
        patch.api_key_encrypted = encryptSecret(key)
        patch.api_key_preview = maskApiKey(key)
      } catch (error) {
        throw providerSettingsErrorFromSecretCrypto(error)
      }
    }
  }
  if (input.clearApiKey === true) {
    patch.api_key_encrypted = null
    patch.api_key_preview = null
  }

  return patch
}

function providerSelectColumns(includeSecret = false) {
  const columns = [
    'id',
    'kind',
    'name',
    'base_url',
    'enabled',
    'priority',
    'default_model',
    'image_model',
    'edit_model',
    'timeout_ms',
    'retry_count',
    'supports_webp_references',
    'notes',
    'created_at',
    'updated_at',
  ]
  columns.push('api_key_preview')
  if (includeSecret) columns.push('api_key_encrypted')
  return columns.join(',')
}

export function clearProviderSettingsCache() {
  providerSettingsCache = null
}

export async function listProviderSettings(options: { refresh?: boolean } = {}) {
  const now = Date.now()
  if (!options.refresh && providerSettingsCache && providerSettingsCache.expiresAt > now) {
    return providerSettingsCache
  }

  const client = getSupabaseAdminClient()
  if (!client) {
    return {
      expiresAt: now + PROVIDER_SETTINGS_CACHE_MS,
      providers: envProviderRows(),
      tableAvailable: false,
    }
  }

  try {
    const { data, error } = await client
      .from(PROVIDER_SETTINGS_TABLE)
      .select(providerSelectColumns(true))
      .order('kind', { ascending: true })
      .order('priority', { ascending: true })
      .order('updated_at', { ascending: false })

    if (error) throw error
    const cache = {
      expiresAt: now + PROVIDER_SETTINGS_CACHE_MS,
      providers: [
        ...((data || []) as unknown as Array<Record<string, unknown>>).map(providerFromRow),
        ...envProviderRows(),
      ],
      tableAvailable: true,
    }
    providerSettingsCache = cache
    return cache
  } catch (err) {
    console.warn('[provider-settings] using env fallback:', safeErrorDetail(err))
    const cache = {
      expiresAt: now + PROVIDER_SETTINGS_CACHE_MS,
      providers: envProviderRows(),
      tableAvailable: false,
    }
    providerSettingsCache = cache
    return cache
  }
}

export async function createProviderSetting(input: Record<string, unknown>, adminUser: RequestUser) {
  const client = getSupabaseAdminClient()
  if (!client) throw new ProviderSettingsError('provider_settings_unavailable', {
    status: 503,
    publicMessage: 'Provider 配置服务暂时不可用。',
  })

  const now = new Date().toISOString()
  const row = {
    ...validateProviderInput(input),
    updated_at: now,
    updated_by: adminUser.id,
  }
  if (!('api_key_encrypted' in row) && input.apiKeyRequired !== false) {
    throw new ProviderSettingsError('provider_api_key_required', {
      publicMessage: '请填写 API key。',
    })
  }

  const { data, error } = await client
    .from(PROVIDER_SETTINGS_TABLE)
    .insert(row)
    .select(providerSelectColumns(true))
    .maybeSingle()
  if (error) throw error
  providerSettingsCache = null
  return providerFromRow(data as unknown as Record<string, unknown>)
}

export async function updateProviderSetting(providerId: string, input: Record<string, unknown>, adminUser: RequestUser) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(providerId)) {
    throw new ProviderSettingsError('invalid_provider_id')
  }

  const client = getSupabaseAdminClient()
  if (!client) throw new ProviderSettingsError('provider_settings_unavailable', {
    status: 503,
    publicMessage: 'Provider 配置服务暂时不可用。',
  })

  const patch = {
    ...validateProviderInput(input, { partial: true }),
    updated_at: new Date().toISOString(),
    updated_by: adminUser.id,
  }
  const { data, error } = await client
    .from(PROVIDER_SETTINGS_TABLE)
    .update(patch)
    .eq('id', providerId)
    .select(providerSelectColumns(true))
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ProviderSettingsError('invalid_provider_id')
  providerSettingsCache = null
  return providerFromRow(data as unknown as Record<string, unknown>)
}

export async function getRuntimeChatProvider(
  model: string,
  options: { strict?: boolean } = {},
): Promise<RuntimeChatProvider | null> {
  const client = getSupabaseAdminClient()
  if (!client) return null

  try {
    const { data, error } = await client
      .from(PROVIDER_SETTINGS_TABLE)
      .select([
        'id',
        'name',
        'base_url',
        'api_key_encrypted',
        'default_model',
        'timeout_ms',
        'retry_count',
      ].join(','))
      .eq('kind', 'chat')
      .eq('enabled', true)
      .not('api_key_encrypted', 'is', null)
      .order('priority', { ascending: true })
      .order('updated_at', { ascending: false })

    if (error) throw error

    const rows = ((data || []) as unknown as Array<Record<string, unknown>>)
    const exactRows = rows.filter(row => rowDefaultModel(row) === model)
    const familyRows = rows.filter((row) => {
      const defaultModel = rowDefaultModel(row)
      return defaultModel !== model && chatProviderMatchesModelName(defaultModel, model)
    })
    const fallbackRows = rows.filter(row => !rowDefaultModel(row))
    const seen = new Set<Record<string, unknown>>()
    const candidates = [...exactRows, ...familyRows, ...fallbackRows].filter((row) => {
      if (seen.has(row)) return false
      seen.add(row)
      return true
    })

    for (const row of candidates) {
      try {
        const provider = runtimeChatProviderFromRow(row)
        if (provider) return provider
      } catch (err) {
        console.warn('[provider-settings] skipping invalid runtime chat provider row:', safeErrorDetail(err))
      }
    }

    return null
  } catch (err) {
    console.warn('[provider-settings] chat provider lookup failed:', safeErrorDetail(err))
    if (options.strict) {
      throw new ProviderSettingsError('runtime_chat_provider_unavailable', {
        status: 503,
        publicMessage: publicSecretCryptoError(err),
      })
    }
    return null
  }
}
