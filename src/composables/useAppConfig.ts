import { computed, readonly, ref } from 'vue'
import { apiUrl } from '../lib/api-base'

export interface ImageModelOption {
  id: string
  name: string
}

export interface PublicAppConfig {
  imageEventsEnabled: boolean
  canvasContextEnabled: boolean
  guestGenerationEnabled: boolean
  imageCreditCostPerImage: number
  availableImageModels: ImageModelOption[]
  defaultImageModel: string
}

const fallbackConfig: PublicAppConfig = {
  imageEventsEnabled: false,
  canvasContextEnabled: false,
  guestGenerationEnabled: true,
  imageCreditCostPerImage: 1,
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

function normalizeConfig(value: unknown): PublicAppConfig {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
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
    availableImageModels: normalizeImageModels(record.availableImageModels),
    defaultImageModel: typeof record.defaultImageModel === 'string'
      ? record.defaultImageModel
      : fallbackConfig.defaultImageModel,
  }
}

async function fetchAppConfig() {
  const response = await fetch(apiUrl('/api/config/app'))
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
