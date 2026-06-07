import { Router, Request, Response } from 'express'
import { mcpManager } from '../mcp/manager.js'

const router = Router()

router.get('/tools', (_req: Request, res: Response) => {
  const servers = Array.from(mcpManager.connections.values()).reduce((summary, conn) => {
    if (conn.status === 'connected') summary.connected += 1
    else summary.error += 1
    return summary
  }, { connected: 0, error: 0 })

  res.json({
    tools: mcpManager.getAllTools(),
    servers,
  })
})

export default router
