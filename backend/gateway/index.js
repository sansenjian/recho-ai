import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import OpenAI from 'openai'

dotenv.config()

const app = express()

const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use(cors({
  origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN
}))
app.use(express.json())

// --- 速率限制器（滑动窗口） ---

class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.timestamps = []
  }

  tryAcquire() {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now)
      return true
    }
    return false
  }

  getWaitTime() {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    if (this.timestamps.length < this.maxRequests) return 0
    return this.timestamps[0] + this.windowMs - now + 50
  }
}

// --- NVIDIA Key 池（多 Key 轮询 + 速率限制） ---

const NVIDIA_RPM = 40 // NVIDIA 每分钟限制

class NvidiaKeyPool {
  constructor(keys, baseURL) {
    this.pool = keys.map(key => ({
      client: new OpenAI({ baseURL, apiKey: key }),
      limiter: new RateLimiter(NVIDIA_RPM, 60_000),
    }))
    this.waiting = 0
  }

  get size() {
    return this.pool.length
  }

  get waitingCount() {
    return this.waiting
  }

  async getClient() {
    this.waiting++
    try {
      while (true) {
        for (const entry of this.pool) {
          if (entry.limiter.tryAcquire()) {
            return entry.client
          }
        }
        const minWait = Math.min(...this.pool.map(e => e.limiter.getWaitTime()))
        await new Promise(resolve => setTimeout(resolve, Math.max(minWait, 200)))
      }
    } finally {
      this.waiting--
    }
  }
}

// --- 初始化各平台 client ---

const clients = {}

function createClient(baseURL, apiKey) {
  if (!apiKey || !baseURL) return null
  return new OpenAI({ baseURL, apiKey })
}

// NVIDIA：支持多 Key，逗号分隔
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

// 根据 model 前缀路由到对应 provider
function getClientByModel(model) {
  if (model.startsWith('gpt-')) return clients.openai
  if (model.includes('/')) return clients.nvidiaPool || clients.kimi || clients.openai
  if (model.startsWith('moonshot') || model.startsWith('kimi-')) return clients.kimi
  return clients.nvidiaPool || clients.openai || clients.kimi
}

async function resolveClient(client) {
  if (client instanceof NvidiaKeyPool) {
    return await client.getClient()
  }
  return client
}

// SSE 流式聊天接口
app.post('/api/chat', async (req, res) => {
  const { model, messages } = req.body
  if (!model || !messages?.length) {
    return res.status(400).json({ error: 'model and messages are required' })
  }

  const clientOrPool = getClientByModel(model)
  if (!clientOrPool) {
    return res.status(400).json({ error: `no client available for model: ${model}` })
  }

  const client = await resolveClient(clientOrPool)

  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
    })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)

      if (chunk.choices?.[0]?.finish_reason) {
        res.write('data: [DONE]\n\n')
        break
      }
    }

    res.end()
  } catch (err) {
    console.error('Chat error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: err.message })
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
    }
  }
})

app.get('/health', (_req, res) => {
  const providers = []
  if (clients.nvidiaPool) {
    providers.push(`nvidia (pool: ${clients.nvidiaPool.size} keys, waiting: ${clients.nvidiaPool.waitingCount})`)
  }
  if (clients.openai) providers.push('openai')
  if (clients.kimi) providers.push('kimi')
  res.json({ status: 'ok', providers })
})

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'recho-ai gateway' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Gateway running on http://localhost:${PORT}`)
})
