import { Router, Request, Response } from 'express'
import { clients } from '../clients/factory.js'
import { hasSupabaseConfig } from '../clients/supabase.js'
import { mcpManager } from '../mcp/manager.js'
import { skillLoader } from '../skills/loader.js'
import { getGoSidecarHealth } from '../services/go-sidecar-health.js'

const router = Router()

router.get('/health', async (_req: Request, res: Response) => {
  const providerCount = [
    clients.nvidiaPool,
    clients.openai,
    clients.kimi,
  ].filter(Boolean).length
  const mcp = Array.from(mcpManager.connections.values()).reduce((summary, conn) => {
    if (conn.status === 'connected') summary.connected += 1
    else summary.error += 1
    return summary
  }, { connected: 0, error: 0 })
  const goSidecar = await getGoSidecarHealth()
  const healthy = goSidecar.ready

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    providers: { configured: providerCount },
    auth: { configured: hasSupabaseConfig() },
    skills: skillLoader.getAll().length,
    mcp,
    goSidecar,
  })
})

export default router
