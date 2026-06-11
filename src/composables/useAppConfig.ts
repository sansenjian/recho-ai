import { computed, readonly, ref } from 'vue'
import { apiUrl } from '../lib/api-base'

export interface PublicAppConfig {
  imageEventsEnabled: boolean
  canvasContextEnabled: boolean
}

const fallbackConfig: PublicAppConfig = {
  imageEventsEnabled: false,
  canvasContextEnabled: false,
}

const config = ref<PublicAppConfig>({ ...fallbackConfig })
const loaded = ref(false)
let configPromise: Promise<PublicAppConfig> | null = null

function normalizeConfig(value: unknown): PublicAppConfig {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    imageEventsEnabled: typeof record.imageEventsEnabled === 'boolean'
      ? record.imageEventsEnabled
      : fallbackConfig.imageEventsEnabled,
    canvasContextEnabled: typeof record.canvasContextEnabled === 'boolean'
      ? record.canvasContextEnabled
      : fallbackConfig.canvasContextEnabled,
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
    ensureAppConfig,
  }
}

export function resetAppConfigForTests() {
  config.value = { ...fallbackConfig }
  loaded.value = false
  configPromise = null
}
