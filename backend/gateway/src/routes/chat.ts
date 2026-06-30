import { Router, Request, Response } from 'express'
import { getClientByModel, acquireClient } from '../clients/factory.js'
import { skillLoader } from '../skills/loader.js'
import { mcpManager } from '../mcp/manager.js'
import { runTAORLoop, sendChatStatus } from '../services/chat-loop.js'
import type { SkillDefinition } from '../skills/types.js'
import { applySkillSystemPrompt, filterToolsForSkill } from './chat-utils.js'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import { getRuntimeChatProvider } from '../services/provider-settings.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'
import OpenAI from 'openai'

const router = Router()

const MAX_RETRIES = 3

const ALLOWED_MODEL_PREFIXES = ['gpt-', 'moonshot', 'kimi-']

function isValidChatModel(model: string): boolean {
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) return true
  if (ALLOWED_MODEL_PREFIXES.some(prefix => model.startsWith(prefix))) return true
  // NVIDIA and other provider models typically contain a '/'
  if (model.includes('/')) return true
  return false
}

router.post('/chat', async (req: Request, res: Response) => {
  const { model, messages, skill } = req.body
  try {
    const user = await getRequestUser(req)
    await assertAdminUser(user)
  } catch (err) {
    if (err instanceof AdminCreditError) {
      res.status(err.status).json({ error: err.publicMessage })
      return
    }
    console.warn('[chat] admin access check failed:', safeErrorDetail(err))
    res.status(500).json({ error: publicErrorMessage(err, 'Chat 权限检查失败，请稍后重试。') })
    return
  }

  if (!model || !messages?.length) {
    res.status(400).json({ error: 'model and messages are required' })
    return
  }

  if (!isValidChatModel(model)) {
    res.status(400).json({ error: `unsupported model: ${model}` })
    return
  }

  let runtimeProvider
  try {
    runtimeProvider = await getRuntimeChatProvider(model)
  } catch (err) {
    console.warn('[chat] provider lookup failed, falling back to env client:', safeErrorDetail(err))
    runtimeProvider = null
  }
  const clientOrPool = runtimeProvider
    ? new OpenAI({
        baseURL: runtimeProvider.baseUrl,
        apiKey: runtimeProvider.apiKey,
        timeout: runtimeProvider.timeoutMs,
      })
    : getClientByModel(model)
  if (!clientOrPool) {
    res.status(400).json({ error: `no client available for model: ${model}` })
    return
  }
  const maxAttempts = runtimeProvider
    ? Math.max(1, Math.min(runtimeProvider.retryCount + 1, 11))
    : MAX_RETRIES

  const controller = new AbortController()
  req.on('close', () => {
    if (!res.writableEnded) {
      controller.abort()
    }
  })

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

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let entry: any = null
    try {
      const acquired = await acquireClient(clientOrPool)
      const client = acquired.client
      entry = acquired.entry

      // Unified TAOR loop: streaming + tools always provided.
      // The model autonomously decides whether to call tools.
      await runTAORLoop(client, model, conversationMessages, tools, res, controller)
      return
    } catch (err: any) {
      if (controller.signal.aborted || res.writableEnded) {
        if (!res.writableEnded) {
          try { res.end() } catch { /* client already gone */ }
        }
        return
      }
      if (err.status === 429 || (err.status >= 500 && err.status < 600)) {
        if (entry) entry.limiter.penalize()
        lastError = err
        continue
      }
      const message = publicErrorMessage(err, 'Chat 请求失败，请稍后重试。')
      console.error('Chat error:', safeErrorDetail(err))
      if (!res.headersSent) {
        res.status(500).json({ error: message })
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
        res.end()
      }
      return
    }
  }

  console.error('All retries exhausted:', safeErrorDetail(lastError))
  const exhaustedMessage = '模型服务暂时不可用，请稍后重试。'
  if (!res.headersSent) {
    res.status(502).json({ error: exhaustedMessage })
  } else {
    res.write(`data: ${JSON.stringify({ type: 'error', error: exhaustedMessage })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

export default router
