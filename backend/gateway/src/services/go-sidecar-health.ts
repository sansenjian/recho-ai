const GO_SIDECAR_HEALTH_CACHE_MS = 5_000
const GO_SIDECAR_HEALTH_TIMEOUT_MS = 2_000

export interface GoSidecarHealth {
  configured: boolean
  ready: boolean
  checkedAt: string
  error?: string
}

let cachedHealth: GoSidecarHealth | null = null
let cachedAt = 0
let pendingHealthCheck: Promise<GoSidecarHealth> | null = null

function goGatewayBaseUrl() {
  return (process.env.GO_GATEWAY_BASE_URL || '').replace(/\/+$/, '')
}

export async function getGoSidecarHealth(now = Date.now()): Promise<GoSidecarHealth> {
  const baseUrl = goGatewayBaseUrl()
  if (!baseUrl) {
    return { configured: false, ready: true, checkedAt: new Date(now).toISOString() }
  }

  if (cachedHealth && now - cachedAt < GO_SIDECAR_HEALTH_CACHE_MS) return cachedHealth
  if (pendingHealthCheck) return pendingHealthCheck

  pendingHealthCheck = (async () => {
    const checkedAt = new Date().toISOString()
    try {
      const response = await fetch(`${baseUrl}/ready`, {
        signal: AbortSignal.timeout(GO_SIDECAR_HEALTH_TIMEOUT_MS),
      })
      const health: GoSidecarHealth = {
        configured: true,
        ready: response.ok,
        checkedAt,
        ...(response.ok ? {} : { error: `Go gateway returned ${response.status}` }),
      }
      cachedHealth = health
      cachedAt = Date.now()
      return health
    } catch {
      const health: GoSidecarHealth = {
        configured: true,
        ready: false,
        checkedAt,
        error: 'Go gateway is unreachable',
      }
      cachedHealth = health
      cachedAt = Date.now()
      return health
    } finally {
      pendingHealthCheck = null
    }
  })()

  return pendingHealthCheck
}

export function resetGoSidecarHealthCache() {
  cachedHealth = null
  cachedAt = 0
  pendingHealthCheck = null
}
