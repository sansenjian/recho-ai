import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { mcpManager } from './mcp/manager.js'
import { skillLoader } from './skills/loader.js'

dotenv.config()

const app = express()

const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use(cors({
  origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN
}))
app.use(express.json({ limit: '50mb' }))

// --- 速率限制器（滑动窗口） ---

class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.timestamps = []
  }

  acquire() {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now)
      return { ok: true, waitMs: 0 }
    }
    return { ok: false, waitMs: this.timestamps[0] + this.windowMs - now + 50 }
  }

  penalize() {
    const now = Date.now()
    this.timestamps = Array(this.maxRequests).fill(now)
  }
}

// --- NVIDIA Key 池 ---

const NVIDIA_RPM = 40
const STREAM_TIMEOUT_MS = 5 * 60 * 1000
const MAX_TOOL_ROUNDS = 5
const ACQUIRE_TIMEOUT_MS = 30_000
const OPENAI_TIMEOUT_MS = 60_000

class NvidiaKeyPool {
  constructor(keys, baseURL) {
    this.pool = keys.map(key => ({
      client: new OpenAI({ baseURL, apiKey: key, timeout: OPENAI_TIMEOUT_MS }),
      limiter: new RateLimiter(NVIDIA_RPM, 60_000),
    }))
    this.waiting = 0
  }

  get size() { return this.pool.length }
  get waitingCount() { return this.waiting }

  async acquire() {
    this.waiting++
    try {
      const startedAt = Date.now()
      while (true) {
        let minWait = Infinity
        for (const entry of this.pool) {
          const result = entry.limiter.acquire()
          if (result.ok) return { client: entry.client, entry }
          if (result.waitMs < minWait) minWait = result.waitMs
        }
        if (Date.now() - startedAt > ACQUIRE_TIMEOUT_MS) {
          throw Object.assign(new Error('all keys rate-limited, please wait'), { status: 429 })
        }
        await new Promise(resolve => setTimeout(resolve, Math.max(minWait, 200)))
      }
    } finally { this.waiting-- }
  }
}

// --- 初始化各平台 client ---

const clients = {}

function createClient(baseURL, apiKey) {
  if (!apiKey || !baseURL) return null
  return new OpenAI({ baseURL, apiKey, timeout: OPENAI_TIMEOUT_MS })
}

const nvidiaKeys = (process.env.NVIDIA_API_KEY || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean)

if (nvidiaKeys.length > 0) {
  clients.nvidiaPool = new NvidiaKeyPool(nvidiaKeys, process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1')
  console.log(`NVIDIA pool initialized with ${nvidiaKeys.length} key(s)`)
}

clients.openai = createClient(process.env.OPENAI_BASE_URL, process.env.OPENAI_API_KEY)
clients.kimi = createClient(process.env.KIMI_BASE_URL, process.env.KIMI_API_KEY)

function getClientByModel(model) {
  if (model.startsWith('gpt-')) return clients.openai
  if (model.includes('/')) return clients.nvidiaPool || clients.kimi || clients.openai
  if (model.startsWith('moonshot') || model.startsWith('kimi-')) return clients.kimi
  return clients.nvidiaPool || clients.openai || clients.kimi
}

async function acquireClient(clientOrPool) {
  if (clientOrPool instanceof NvidiaKeyPool) return await clientOrPool.acquire()
  return { client: clientOrPool, entry: null }
}

// --- Tool calling loop ---

async function runWithTools(client, model, messages, tools, res) {
  const msgs = messages.map(m => ({ ...m }))
  let toolCalled = false

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model,
      messages: msgs,
      tools,
      stream: false,
    })

    const choice = response.choices[0]
    if (!choice) break

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      toolCalled = true
      console.log(`[chat] LLM requested ${choice.message.tool_calls.length} tool(s): ${choice.message.tool_calls.map(tc => tc.function.name).join(', ')}`)
      msgs.push(choice.message)

      for (const tc of choice.message.tool_calls) {
        const toolName = tc.function.name
        let args = {}
        try { args = JSON.parse(tc.function.arguments) } catch { /* keep empty */ }

        res.write(`data: ${JSON.stringify({ type: 'tool_call', name: toolName, arguments: args })}\n\n`)

        let toolResult
        try {
          toolResult = await Promise.race([
            mcpManager.executeTool(toolName, args),
            new Promise((_, reject) => setTimeout(() => reject(new Error('tool timeout after 30s')), 30_000)),
          ])
        } catch (err) {
          toolResult = { content: [{ type: 'text', text: `Error: ${err.message}` }] }
        }

        const content = toolResult?.content?.map(c => c.text || '').join('\n') || JSON.stringify(toolResult)
        res.write(`data: ${JSON.stringify({ type: 'tool_result', name: toolName, result: content.slice(0, 2000) })}\n\n`)

        msgs.push({ role: 'tool', tool_call_id: tc.id, content })
      }
    } else {
      // No more tool calls — return resolved messages
      return { messages: msgs, finalContent: choice.message.content || '', toolCalled }
    }
  }

  // Max rounds reached
  return { messages: msgs, finalContent: '', toolCalled }
}

// SSE 流式输出（不设 headers，调用前确保已设置）
async function streamResponse(client, model, messages, res) {
  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
  })

  const timeout = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'stream timeout' })}\n\n`)
      res.end()
    }
  }, STREAM_TIMEOUT_MS)

  try {
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      if (chunk.choices?.[0]?.finish_reason) {
        res.write('data: [DONE]\n\n')
        break
      }
    }
  } finally {
    clearTimeout(timeout)
    if (!res.writableEnded) res.end()
  }
}

// --- API 路由 ---

// 获取可用技能列表
app.get('/api/skills', (_req, res) => {
  res.json({ skills: skillLoader.getAll() })
})

// 获取 MCP 工具列表
app.get('/api/tools', (_req, res) => {
  res.json({
    tools: mcpManager.getAllTools(),
    servers: Array.from(mcpManager.connections.entries()).map(([name, conn]) => ({
      name,
      status: conn.status,
      toolCount: conn.tools.length,
    })),
  })
})

// 聊天接口（支持 Skill + MCP 工具调用）
app.post('/api/chat', async (req, res) => {
  const { model, messages, skill } = req.body
  if (!model || !messages?.length) {
    return res.status(400).json({ error: 'model and messages are required' })
  }

  const clientOrPool = getClientByModel(model)
  if (!clientOrPool) {
    return res.status(400).json({ error: `no client available for model: ${model}` })
  }

  // 处理 skill：替换 system prompt + 收集工具
  let activeSkill = null
  const conversationMessages = messages.map(m => ({ ...m }))

  if (skill && skillLoader.has(skill)) {
    activeSkill = skillLoader.get(skill)
    const sysIdx = conversationMessages.findIndex(m => m.role === 'system')
    if (sysIdx !== -1 && activeSkill.system_prompt) {
      conversationMessages[sysIdx].content = activeSkill.system_prompt
    } else if (activeSkill.system_prompt) {
      conversationMessages.unshift({ role: 'system', content: activeSkill.system_prompt })
    }
  }

  // 只有选了 skill 时才收集工具
  let tools = []
  if (activeSkill?.tools?.length) {
    const mcpTools = mcpManager.getAllTools()
    const skillToolNames = new Set(activeSkill.tools)
    tools = mcpTools.filter(t => skillToolNames.has(t.function.name))
  }
  console.log(`[chat] skill=${activeSkill?.name || 'none'}, tools=${tools.map(t => t.function.name).join(',') || 'none'}`)

  const MAX_RETRIES = 3
  let lastError = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { client, entry } = await acquireClient(clientOrPool)

    try {
      // 在第一个 res.write 前设置 SSE headers
      if (attempt === 0) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
      }

      if (tools.length > 0) {
        // 工具调用模式：先解析工具，再流式输出最终回复
        const { messages: resolvedMessages, finalContent, toolCalled } =
          await runWithTools(client, model, conversationMessages, tools, res)

        if (toolCalled) {
          res.write(`data: ${JSON.stringify({ type: 'tool_end' })}\n\n`)
        }

        // 流式输出最终回复（用解析后的消息列表）
        await streamResponse(client, model, resolvedMessages, res)
        return
      }

      // 无工具模式：直接流式输出
      await streamResponse(client, model, conversationMessages, res)
      return
    } catch (err) {
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
  }
})

app.get('/health', (_req, res) => {
  const providers = []
  if (clients.nvidiaPool) {
    providers.push(`nvidia (pool: ${clients.nvidiaPool.size} keys, waiting: ${clients.nvidiaPool.waitingCount})`)
  }
  if (clients.openai) providers.push('openai')
  if (clients.kimi) providers.push('kimi')
  const mcpStatus = Array.from(mcpManager.connections.entries()).map(([n, c]) => `${n}: ${c.status}`)
  res.json({ status: 'ok', providers, skills: skillLoader.getAll().length, mcp: mcpStatus })
})

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'recho-ai gateway' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  console.log(`Gateway running on http://localhost:${PORT}`)
  await skillLoader.load()
  await mcpManager.initialize()
})
