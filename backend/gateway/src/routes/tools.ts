import { Router, Request, Response } from 'express'
import { mcpManager } from '../mcp/manager.js'

const router = Router()

router.get('/tools', (_req: Request, res: Response) => {
  res.json({
    tools: mcpManager.getAllTools(),
    servers: Array.from(mcpManager.connections.entries()).map(([name, conn]) => ({
      name,
      status: conn.status,
      toolCount: conn.tools.length,
    })),
  })
})

export default router
