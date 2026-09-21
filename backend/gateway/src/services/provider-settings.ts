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
export type ImageProviderCompatibilityMode = 'auto' | 'openai' | 'lucen'

export interface ProviderModel {
  id: string
  name: string
  enabled: boolean
  // Per-row edit model: used when the request carries reference images. It is
  // deliberately not part of the model list clients may select from.
  editModel: string | null
}

export interface ProviderSetting {
  id: string
  kind: ProviderKind
  name: string
  baseUrl: string
  enabled: boolean
  priority: number
  defaultModel: string | null
  models: string[]
  modelCatalog: ProviderModel[]
  imageModel: string | null
  editModel: string | null
  imageCompatibilityMode: ImageProviderCompatibilityMode
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
  models: string[]
  modelCatalog: ProviderModel[]
  resolvedModel: string
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
  // 本函数的契约是「规范化」：换行归一为空格 → 去首尾空白 → 截到 maxLength → 再去一次首尾空白。
  // 最后那次 trim 不可省：截断本身会把空白带回尾部（`'a'.repeat(119) + ' b'` 截到 120 位后
  // 正好以空格结尾），而清洗函数的输出必须能通过下游校验（isValidChatModel），
  // 否则「稍微过长」的输入会变成整单 400 拒绝（写路径）或把配置静默归一为 null（读路径）。
  //
  // 这**不等于**与 Go 等价：Go `normalizeModelName` 只做 TrimSpace 后判长，trim 后超过 120 就
  // 丢弃（**不截断**，得不出 'a'.repeat(119)）。此处截断是沿用 maxLength 的既有契约
  // （'e'.repeat(130) → 'e'.repeat(120)），并非与 Go 同语义。
  // 两者唯一的对齐点是：Node 落库值必 ≤ maxLength，因此一定过得了 Go 的校验。
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength).trim()
}

function nullableText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength)
  return text || null
}

export function isValidChatModel(model: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)
}

function normalizeModelList(value: unknown, options: { rejectInvalid?: boolean } = {}): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]+/) : []
  const models = [...new Set(values.map(item => cleanText(item, 120)).filter(Boolean))].slice(0, 100)
  const invalid = models.find(model => !isValidChatModel(model))
  if (invalid && options.rejectInvalid) {
    throw new ProviderSettingsError('invalid_chat_model', {
      publicMessage: `模型 ID 无效：${invalid}`,
    })
  }
  return models.filter(isValidChatModel)
}

function normalizeModelCatalog(value: unknown, options: { rejectInvalid?: boolean } = {}): ProviderModel[] {
  if (!Array.isArray(value)) return []
  const result: ProviderModel[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const record = typeof item === 'string' ? { id: item } : item
    if (!record || typeof record !== 'object') continue
    const source = record as Record<string, unknown>
    const id = cleanText(source.id, 120)
    if (!id || seen.has(id)) continue
    if (!isValidChatModel(id)) {
      if (options.rejectInvalid) throw new ProviderSettingsError('invalid_chat_model', {
        publicMessage: `模型 ID 无效：${id}`,
      })
      continue
    }
    seen.add(id)
    const editModel = cleanText(source.editModel, 120)
    if (editModel && !isValidChatModel(editModel) && options.rejectInvalid) {
      throw new ProviderSettingsError('invalid_edit_model', {
        publicMessage: `编辑模型 ID 无效：${editModel}`,
      })
    }
    result.push({
      id,
      name: cleanText(source.name, 120) || id,
      enabled: source.enabled !== false,
      editModel: isValidChatModel(editModel) ? editModel : null,
    })
  }
  return result.slice(0, 100)
}

function modelCatalogFromInput(input: Record<string, unknown>): ProviderModel[] {
  const catalog = normalizeModelCatalog(input.modelCatalog, { rejectInvalid: true })
  if (catalog.length > 0) return catalog
  return normalizeModelList(input.models, { rejectInvalid: true }).map(id => ({ id, name: id, enabled: true, editModel: null }))
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

function normalizeImageCompatibilityMode(value: unknown): ImageProviderCompatibilityMode {
  if (value === undefined || value === null || value === '') return 'auto'
  if (value === 'auto' || value === 'openai' || value === 'lucen') return value
  throw new ProviderSettingsError('invalid_image_compatibility_mode', {
    publicMessage: '图片兼容预设必须是自动判断、标准 OpenAI 或 Lucen / sub2api OAuth。',
  })
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
      models: [],
      modelCatalog: [],
      imageModel: IMAGE_RESPONSES_IMAGE_MODEL,
      editModel: IMAGE_RESPONSES_IMAGE_MODEL,
      imageCompatibilityMode: 'auto',
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
      models: ['gpt-4o-mini'],
      modelCatalog: [{ id: 'gpt-4o-mini', name: 'gpt-4o-mini', enabled: true, editModel: null }],
      imageModel: null,
      editModel: null,
      imageCompatibilityMode: 'auto',
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
      models: ['kimi-k2-0711-preview'],
      modelCatalog: [{ id: 'kimi-k2-0711-preview', name: 'kimi-k2-0711-preview', enabled: true, editModel: null }],
      imageModel: null,
      editModel: null,
      imageCompatibilityMode: 'auto',
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
    defaultModel: typeof row.default_model === 'string' && isValidChatModel(row.default_model.trim())
      ? row.default_model.trim()
      : null,
    models: normalizeModelList(row.models),
    modelCatalog: (() => {
      const catalog = normalizeModelCatalog(row.model_catalog)
      return catalog.length > 0 ? catalog : normalizeModelList(row.models).map(id => ({ id, name: id, enabled: true, editModel: null }))
    })(),
    imageModel: typeof row.image_model === 'string' && row.image_model ? row.image_model : null,
    editModel: typeof row.edit_model === 'string' && row.edit_model ? row.edit_model : null,
    imageCompatibilityMode: normalizeImageCompatibilityMode(row.image_compatibility_mode),
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

function runtimeChatProviderFromRow(row: Record<string, unknown>, requestedModel?: string, requestedName?: string): RuntimeChatProvider | null {
  let apiKey = ''
  const encryptedKey = typeof row.api_key_encrypted === 'string' ? row.api_key_encrypted.trim() : ''
  if (encryptedKey) {
    apiKey = decryptSecret(encryptedKey)
  }
  const baseUrl = typeof row.base_url === 'string' ? row.base_url.trim().replace(/\/+$/, '') : ''
  if (!apiKey || !baseUrl) return null
  const catalog = normalizeModelCatalog(row.model_catalog)
  const models = catalog.length > 0 ? catalog : normalizeModelList(row.models).map(id => ({ id, name: id, enabled: true, editModel: null }))
  const resolvedModel = models.find(item => item.enabled && (
    item.id === requestedModel ||
    item.name.trim().toLowerCase() === requestedModel?.trim().toLowerCase() ||
    item.name.trim().toLowerCase() === requestedName?.trim().toLowerCase()
  ))?.id
    || rowDefaultModel(row)
    || models.find(item => item.enabled)?.id
    || requestedModel
    || ''
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    baseUrl,
    apiKey,
    defaultModel: typeof row.default_model === 'string' && isValidChatModel(row.default_model.trim())
      ? row.default_model.trim()
      : null,
    models: models.map(item => item.id),
    modelCatalog: models,
    resolvedModel,
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

function validateProviderInput(
  input: Record<string, unknown>,
  options: { partial?: boolean; kind?: ProviderKind } = {},
) {
  const patch: Record<string, unknown> = {}

  if (!options.partial || 'kind' in input) patch.kind = normalizeKind(input.kind)
  // Partial updates usually omit `kind`, so callers pass the merged kind of the
  // stored row. Without it we cannot tell whether a catalog edit should sync
  // default_model (chat) or image_model (image).
  const effectiveKind = options.kind ?? (typeof patch.kind === 'string' ? (patch.kind as ProviderKind) : undefined)
  if (!options.partial || 'name' in input) patch.name = normalizeName(input.name)
  if (!options.partial || 'baseUrl' in input) patch.base_url = normalizeBaseUrl(input.baseUrl)
  if ('enabled' in input) patch.enabled = normalizeBoolean(input.enabled)
  if ('priority' in input) patch.priority = normalizeInt(input.priority, 100, 0, 10_000)
  if ('defaultModel' in input) patch.default_model = nullableText(input.defaultModel, 120)
  const catalogProvided = 'models' in input || 'modelCatalog' in input
  if (catalogProvided) {
    const modelCatalog = modelCatalogFromInput(input)
    const enabledCatalog = modelCatalog.filter(model => model.enabled)
    if (effectiveKind === 'chat' && enabledCatalog.length === 0) {
      throw new ProviderSettingsError('chat_provider_models_required', {
        publicMessage: 'Chat Provider 至少需要配置一个模型。',
      })
    }
    patch.models = modelCatalog.map(model => model.id)
    patch.model_catalog = modelCatalog
    if (effectiveKind === 'chat') patch.default_model = enabledCatalog[0]?.id || null
    // Image providers treat the catalog as selectable generation models and keep
    // image_model as the default (first enabled entry). edit_model is untouched:
    // it stays the provider-level *fallback* edit model, while each catalog row
    // now carries its own editModel inside model_catalog.
    if (effectiveKind === 'image') patch.image_model = enabledCatalog[0]?.id || null
  }
  // The catalog is the source of truth for an image provider's default generation
  // model, so an explicitly supplied imageModel must not overwrite the value just
  // derived from it. Otherwise a create request carrying both an all-disabled
  // catalog and a stale imageModel would persist a model the operator disabled.
  if ('imageModel' in input && !(effectiveKind === 'image' && catalogProvided)) {
    patch.image_model = nullableText(input.imageModel, 120)
  }
  if ('editModel' in input) patch.edit_model = nullableText(input.editModel, 120)
  if ('imageCompatibilityMode' in input) patch.image_compatibility_mode = normalizeImageCompatibilityMode(input.imageCompatibilityMode)
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

type ProviderModelColumnMode = 'both' | 'models' | 'catalog' | 'none'

function providerSelectColumns(includeSecret = false, modelColumns: ProviderModelColumnMode = 'both') {
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
    'image_compatibility_mode',
    'timeout_ms',
    'retry_count',
    'supports_webp_references',
    'notes',
    'created_at',
    'updated_at',
  ]
  if (modelColumns === 'both') columns.splice(7, 0, 'models', 'model_catalog')
  if (modelColumns === 'models') columns.splice(7, 0, 'models')
  if (modelColumns === 'catalog') columns.splice(7, 0, 'model_catalog')
  columns.push('api_key_preview')
  if (includeSecret) columns.push('api_key_encrypted')
  return columns.join(',')
}

function isMissingModelsColumnError(error: unknown) {
  const record = error as Record<string, unknown> | null
  const code = typeof record?.code === 'string' ? record.code.toLowerCase() : ''
  const text = [record?.message, record?.details, record?.hint].filter(Boolean).join(' ').toLowerCase()
  return (code === '42703' || code === 'pgrst204' || text.includes('schema cache')) &&
    text.includes('models') &&
    (text.includes('column') || text.includes('does not exist') || text.includes('could not find'))
}

function isMissingModelCatalogColumnError(error: unknown) {
  const record = error as Record<string, unknown> | null
  const code = typeof record?.code === 'string' ? record.code.toLowerCase() : ''
  const text = [record?.message, record?.details, record?.hint].filter(Boolean).join(' ').toLowerCase()
  return (code === '42703' || code === 'pgrst204' || text.includes('schema cache')) &&
    text.includes('model_catalog') &&
    (text.includes('column') || text.includes('does not exist') || text.includes('could not find'))
}

function modelColumnFallbackMode(error: unknown): ProviderModelColumnMode | null {
  const modelsMissing = isMissingModelsColumnError(error)
  const catalogMissing = isMissingModelCatalogColumnError(error)
  if (!modelsMissing && !catalogMissing) return null
  if (modelsMissing && catalogMissing) return 'none'
  return modelsMissing ? 'catalog' : 'models'
}

function runtimeProviderSelectColumns(modelColumns: ProviderModelColumnMode = 'both') {
  const columns = [
    'id',
    'name',
    'base_url',
    'api_key_encrypted',
    'default_model',
    'timeout_ms',
    'retry_count',
  ]
  if (modelColumns === 'both' || modelColumns === 'models') columns.splice(5, 0, 'models')
  if (modelColumns === 'both' || modelColumns === 'catalog') columns.splice(modelColumns === 'catalog' ? 5 : 6, 0, 'model_catalog')
  return columns.join(',')
}

async function loadProviderRow(client: any, providerId: string) {
  let response = await client
    .from(PROVIDER_SETTINGS_TABLE)
    .select(providerSelectColumns(true))
    .eq('id', providerId)
    .maybeSingle()
  const fallbackMode = modelColumnFallbackMode(response.error)
  if (fallbackMode) {
    response = await client
      .from(PROVIDER_SETTINGS_TABLE)
      .select(providerSelectColumns(true, fallbackMode))
      .eq('id', providerId)
      .maybeSingle()
    if (modelColumnFallbackMode(response.error)) {
      response = await client
        .from(PROVIDER_SETTINGS_TABLE)
        .select(providerSelectColumns(true, 'none'))
        .eq('id', providerId)
        .maybeSingle()
    }
  }
  if (response.error) throw response.error
  return response.data as Record<string, unknown> | null
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
    let { data, error } = await client
      .from(PROVIDER_SETTINGS_TABLE)
      .select(providerSelectColumns(true))
      .order('kind', { ascending: true })
      .order('priority', { ascending: true })
      .order('updated_at', { ascending: false })

    const fallbackMode = modelColumnFallbackMode(error)
    if (fallbackMode) {
      const legacy = await client
        .from(PROVIDER_SETTINGS_TABLE)
        .select(providerSelectColumns(true, fallbackMode))
        .order('kind', { ascending: true })
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false })
      data = legacy.data
      error = legacy.error
      if (modelColumnFallbackMode(error)) {
        const minimal = await client
          .from(PROVIDER_SETTINGS_TABLE)
          .select(providerSelectColumns(true, 'none'))
          .order('kind', { ascending: true })
          .order('priority', { ascending: true })
          .order('updated_at', { ascending: false })
        data = minimal.data
        error = minimal.error
      }
    }
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

  const existingRow = await loadProviderRow(client, providerId)
  if (!existingRow) throw new ProviderSettingsError('invalid_provider_id')

  const mergedKind = 'kind' in input ? normalizeKind(input.kind) : normalizeKind(existingRow.kind)
  const modelsProvided = 'models' in input || 'modelCatalog' in input
  const existingImageModel = nullableText(existingRow.image_model, 120)
  const existingCatalog = normalizeModelCatalog(existingRow.model_catalog)
  const storedModels = normalizeModelList(existingRow.models).map(id => ({ id, name: id, enabled: true, editModel: null }))
  const existingModels = existingCatalog.length > 0
    ? existingCatalog
    : storedModels.length > 0
      ? storedModels
      : (mergedKind === 'image' && existingImageModel
        ? [{ id: existingImageModel, name: existingImageModel, enabled: true, editModel: null }]
        : [])
  const requestedCatalog = modelsProvided ? modelCatalogFromInput(input) : existingModels
  const effectiveCatalog = requestedCatalog.length > 0
    ? requestedCatalog
    : (!modelsProvided && mergedKind === 'chat' && rowDefaultModel(existingRow)
      ? [{ id: rowDefaultModel(existingRow), name: rowDefaultModel(existingRow), enabled: true, editModel: null }]
      : [])
  if (mergedKind === 'chat' && effectiveCatalog.filter(model => model.enabled).length === 0) {
    throw new ProviderSettingsError('chat_provider_models_required', {
      publicMessage: 'Chat Provider 至少需要配置一个模型。',
    })
  }

  const patch: Record<string, unknown> = {
    ...validateProviderInput(input, { partial: true, kind: mergedKind }),
    updated_at: new Date().toISOString(),
    updated_by: adminUser.id,
  }
  if (modelsProvided) {
    patch.models = requestedCatalog.map(model => model.id)
    patch.model_catalog = requestedCatalog
    const enabledDefault = requestedCatalog.find(model => model.enabled)?.id ?? null
    if (mergedKind === 'chat') patch.default_model = enabledDefault
    if (mergedKind === 'image') patch.image_model = enabledDefault
  } else if ('kind' in input) {
    const enabledDefault = effectiveCatalog.find(model => model.enabled)?.id ?? null
    if (mergedKind === 'chat') patch.default_model = enabledDefault
    if (mergedKind === 'image') patch.image_model = enabledDefault ?? existingImageModel
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
  if (!client) {
    if (options.strict) {
      throw new ProviderSettingsError('runtime_chat_provider_unavailable', {
        status: 503,
        publicMessage: 'Chat Provider 配置暂时不可用，请稍后重试。',
      })
    }
    return null
  }

  try {
    let { data, error } = await client
      .from(PROVIDER_SETTINGS_TABLE)
      .select(runtimeProviderSelectColumns())
      .eq('kind', 'chat')
      .eq('enabled', true)
      .not('api_key_encrypted', 'is', null)
      .order('priority', { ascending: true })
      .order('updated_at', { ascending: false })

    const fallbackMode = modelColumnFallbackMode(error)
    if (fallbackMode) {
      const legacy = await client
        .from(PROVIDER_SETTINGS_TABLE)
        .select(runtimeProviderSelectColumns(fallbackMode))
        .eq('kind', 'chat')
        .eq('enabled', true)
        .not('api_key_encrypted', 'is', null)
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false })
      data = legacy.data
      error = legacy.error
      if (modelColumnFallbackMode(error)) {
        const minimal = await client
          .from(PROVIDER_SETTINGS_TABLE)
          .select(runtimeProviderSelectColumns('none'))
          .eq('kind', 'chat')
          .eq('enabled', true)
          .not('api_key_encrypted', 'is', null)
          .order('priority', { ascending: true })
          .order('updated_at', { ascending: false })
        data = minimal.data
        error = minimal.error
      }
    }
    if (error) throw error

    const rows = ((data || []) as unknown as Array<Record<string, unknown>>)
    const requestedName = model.trim().toLowerCase()
    const requestedAliases = new Set(rows.flatMap(row => {
      const catalog = normalizeModelCatalog(row.model_catalog)
      return catalog.filter(item => item.enabled && item.id === model).map(item => item.name.trim().toLowerCase())
    }))
    const exactRows = rows.filter(row => {
      const catalog = normalizeModelCatalog(row.model_catalog)
      const entries = catalog.length > 0 ? catalog.filter(item => item.enabled) : normalizeModelList(row.models).map(id => ({ id, name: id, enabled: true, editModel: null }))
      return entries.some(item => item.id === model || requestedAliases.has(item.name.trim().toLowerCase()) || item.name.trim().toLowerCase() === requestedName) || rowDefaultModel(row) === model
    })
    const familyRows = rows.filter((row) => {
      const configured = normalizeModelList(row.models)
      const defaultModel = rowDefaultModel(row)
      return configured.length === 0 && defaultModel !== model && chatProviderMatchesModelName(defaultModel, model)
    })
    const fallbackRows = rows.filter(row => normalizeModelList(row.models).length === 0 && !rowDefaultModel(row))
    const seen = new Set<Record<string, unknown>>()
    const candidates = [...exactRows, ...familyRows, ...fallbackRows].filter((row) => {
      if (seen.has(row)) return false
      seen.add(row)
      return true
    })

    let candidateError: unknown = null
    for (const row of candidates) {
      try {
        const provider = runtimeChatProviderFromRow(row, model, requestedAliases.values().next().value)
        if (provider) return provider
      } catch (err) {
        candidateError = err
        console.warn('[provider-settings] skipping invalid runtime chat provider row:', safeErrorDetail(err))
      }
    }

    if (options.strict && (candidates.length > 0 || candidateError)) {
      throw new ProviderSettingsError('runtime_chat_provider_unavailable', {
        status: 503,
        publicMessage: candidateError ? publicSecretCryptoError(candidateError) : 'Chat Provider 配置暂时不可用，请稍后重试。',
      })
    }

    return null
  } catch (err) {
    if (err instanceof ProviderSettingsError) {
      throw err
    }
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
