import OpenAI from 'openai'
import { RateLimiter } from '../middleware/rate-limiter.js'
import {
  NVIDIA_RPM,
  NVIDIA_API_KEY,
  NVIDIA_BASE_URL,
  OPENAI_TIMEOUT_MS,
  ACQUIRE_TIMEOUT_MS,
} from '../config.js'

interface PoolEntry {
  client: OpenAI
  limiter: RateLimiter
}

export class NvidiaKeyPool {
  private pool: PoolEntry[]
  private waiting: number = 0

  constructor(keys: string[], baseURL: string = NVIDIA_BASE_URL) {
    this.pool = keys.map(key => ({
      client: new OpenAI({ baseURL, apiKey: key, timeout: OPENAI_TIMEOUT_MS }),
      limiter: new RateLimiter(NVIDIA_RPM, 60_000),
    }))
  }

  get size(): number { return this.pool.length }
  get waitingCount(): number { return this.waiting }

  async acquire(): Promise<{ client: OpenAI; entry: PoolEntry }> {
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
