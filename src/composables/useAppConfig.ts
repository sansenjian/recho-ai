import { computed, readonly, ref } from 'vue'
import { apiFetch, apiUrl } from '../lib/api-base'

export interface ImageModelOption {
  id: string
  name: string
}

export interface ImageModelCreditCost {
  id: string
  cost: number
}

export interface PublicAppConfig {
  chatModels: Array<{ id: string; name: string; provider: string; providers?: string[] }>
  imageEventsEnabled: boolean
  canvasContextEnabled: boolean
  guestGenerationEnabled: boolean
  imageCreditCostPerImage: number
  /** 按模型覆盖价；未命中覆盖价的模型回退 imageCreditCostPerImage。 */
  imageModelCreditCosts: ImageModelCreditCost[]
  availableImageModels: ImageModelOption[]
  defaultImageModel: string
}

const fallbackConfig: PublicAppConfig = {
  chatModels: [],
  imageEventsEnabled: false,
  canvasContextEnabled: false,
  guestGenerationEnabled: true,
  imageCreditCostPerImage: 1,
  imageModelCreditCosts: [],
  availableImageModels: [],
  defaultImageModel: '',
}

const config = ref<PublicAppConfig>({ ...fallbackConfig })
const loaded = ref(false)
let configPromise: Promise<PublicAppConfig> | null = null

function normalizeImageModels(value: unknown): ImageModelOption[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({ id: item.id as string, name: typeof item.name === 'string' ? item.name as string : item.id as string }))
}

function normalizeImageModelCreditCosts(value: unknown): ImageModelCreditCost[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: ImageModelCreditCost[] = []
  for (const item of value) {
    if (item == null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    // 非法单价在服务端已被丢弃；这里同样丢弃，避免出现「覆盖价为 0/NaN」的假数据。
    if (!id || seen.has(id) || typeof record.cost !== 'number' || !Number.isFinite(record.cost) || record.cost < 0.01) continue
    seen.add(id)
    result.push({ id, cost: Math.round(record.cost * 100) / 100 })
  }
  return result
}

function normalizeConfig(value: unknown): PublicAppConfig {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const chatModels = Array.isArray(record.chatModels)
    ? record.chatModels
      .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string')
      .map(item => ({
        id: item.id as string,
        name: typeof item.name === 'string' && item.name ? item.name : item.id as string,
        provider: typeof item.provider === 'string' && item.provider ? item.provider : 'Custom',
        providers: Array.isArray(item.providers) ? item.providers.filter((value): value is string => typeof value === 'string') : undefined,
      }))
    : []
  return {
    chatModels,
    imageEventsEnabled: typeof record.imageEventsEnabled === 'boolean'
      ? record.imageEventsEnabled
      : fallbackConfig.imageEventsEnabled,
    canvasContextEnabled: typeof record.canvasContextEnabled === 'boolean'
      ? record.canvasContextEnabled
      : fallbackConfig.canvasContextEnabled,
    guestGenerationEnabled: typeof record.guestGenerationEnabled === 'boolean'
      ? record.guestGenerationEnabled
      : fallbackConfig.guestGenerationEnabled,
    imageCreditCostPerImage: typeof record.imageCreditCostPerImage === 'number' && Number.isFinite(record.imageCreditCostPerImage)
      ? Math.max(0.01, Math.round(record.imageCreditCostPerImage * 100) / 100)
      : fallbackConfig.imageCreditCostPerImage,
    imageModelCreditCosts: normalizeImageModelCreditCosts(record.imageModelCreditCosts),
    availableImageModels: normalizeImageModels(record.availableImageModels),
    defaultImageModel: typeof record.defaultImageModel === 'string'
      ? record.defaultImageModel
      : fallbackConfig.defaultImageModel,
  }
}

async function fetchAppConfig() {
  const response = await apiFetch(apiUrl('/api/config/app'))
  if (!response.ok) {
    throw new Error('无法读取应用配置')
  }
  return normalizeConfig(await response.json())
}

export async function ensureAppConfig(options: { refresh?: boolean } = {}) {
  if (loaded.value && !options.refresh) return config.value

  configPromise = options.refresh || !configPromise
    ? fetchAppConfig()
      .then((nextConfig) => {
        config.value = nextConfig
        loaded.value = true
        return nextConfig
      })
      .catch((error) => {
        console.warn('[app-config] using fallback config', error)
        configPromise = null
        return config.value
      })
    : configPromise

  return await configPromise
}

export function useAppConfig() {
  return {
    config: readonly(config),
    chatModels: computed(() => config.value.chatModels),
    isLoaded: readonly(loaded),
    imageEventsEnabled: computed(() => config.value.imageEventsEnabled),
    canvasContextEnabled: computed(() => config.value.canvasContextEnabled),
    guestGenerationEnabled: computed(() => config.value.guestGenerationEnabled),
    imageCreditCostPerImage: computed(() => config.value.imageCreditCostPerImage),
    availableImageModels: computed(() => config.value.availableImageModels),
    defaultImageModel: computed(() => config.value.defaultImageModel),
    ensureAppConfig,
  }
}

export function resetAppConfigForTests() {
  config.value = { ...fallbackConfig }
  loaded.value = false
  configPromise = null
}
