import { Router, Request, Response } from 'express'
import { getClientByModel, acquireClient } from '../clients/factory.js'
import { skillLoader } from '../skills/loader.js'
import { mcpManager } from '../mcp/manager.js'
import { runTAORLoop, sendChatStatus } from '../services/chat-loop.js'
import type { SkillDefinition } from '../skills/types.js'
import { applySkillSystemPrompt, filterToolsForSkill } from './chat-utils.js'

const router = Router()

const MAX_RETRIES = 3

router.post('/chat', async (req: Request, res: Response) => {
  const { model, messages, skill } = req.body
  if (!model || !messages?.length) {
    res.status(400).json({ error: 'model and messages are required' })
    return
  }

  const clientOrPool = getClientByModel(model)
  if (!clientOrPool) {
    res.status(400).json({ error: `no client available for model: ${model}` })
    return
  }

  let activeSkill: SkillDefinition | null = null
  let conversationMessages = messages.map((m: any) => ({ ...m }))

  if (skill && skillLoader.has(skill)) {
    activeSkill = skillLoader.get(skill)
    conversationMessages = applySkillSystemPrompt(conversationMessages, activeSkill!.system_prompt)
  }

  const tools = filterToolsForSkill(mcpManager.getAllTools(), activeSkill)
  console.log(`[chat] skill=${activeSkill?.name || 'none'}, tools=${tools.map((t: any) => t.function.name).join(',') || 'none'}`)

  let lastError: Error | null = null
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  await sendChatStatus(res, 'thinking', '连接模型服务')

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let entry: any = null
    try {
      const acquired = await acquireClient(clientOrPool)
      const client = acquired.client
      entry = acquired.entry

      // Unified TAOR loop: streaming + tools always provided.
      // The model autonomously decides whether to call tools.
      await runTAORLoop(client, model, conversationMessages, tools, res)
      return
    } catch (err: any) {
      if (err.status === 429 || (err.status >= 500 && err.status < 600)) {
        if (entry) entry.limiter.penalize()
        lastError = err
        continue
      }
      console.error('Chat error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: err.message })
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
        res.end()
      }
      return
    }
  }

  console.error('All retries exhausted:', lastError?.message)
  if (!res.headersSent) {
    res.status(502).json({ error: 'all available keys exhausted, please try again later' })
  } else {
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'all available keys exhausted, please try again later' })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

export default router
