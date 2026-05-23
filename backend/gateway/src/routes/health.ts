import { Router, Request, Response } from 'express'
import { clients } from '../clients/factory.js'
import { mcpManager } from '../mcp/manager.js'
import { skillLoader } from '../skills/loader.js'

const router = Router()

router.get('/health', (_req: Request, res: Response) => {
  const providers: string[] = []
  if (clients.nvidiaPool) {
    providers.push(`nvidia (pool: ${clients.nvidiaPool.size} keys, waiting: ${clients.nvidiaPool.waitingCount})`)
  }
  if (clients.openai) providers.push('openai')
  if (clients.kimi) providers.push('kimi')
  const mcpStatus = Array.from(mcpManager.connections.entries()).map(([n, c]) => `${n}: ${c.status}`)
  res.json({ status: 'ok', providers, skills: skillLoader.getAll().length, mcp: mcpStatus })
})

export default router
