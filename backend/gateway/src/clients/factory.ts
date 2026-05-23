import OpenAI from 'openai'
import { NvidiaKeyPool } from './pool.js'
import {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  KIMI_API_KEY,
  KIMI_BASE_URL,
  NVIDIA_API_KEY,
  NVIDIA_BASE_URL,
  OPENAI_TIMEOUT_MS,
} from '../config.js'

interface ClientEntry {
  openai: OpenAI | null
  kimi: OpenAI | null
  nvidiaPool: NvidiaKeyPool | null
}

export const clients: ClientEntry = {
  openai: null,
  kimi: null,
  nvidiaPool: null,
}

function createClient(baseURL?: string, apiKey?: string): OpenAI | null {
  if (!apiKey || !baseURL) return null
  return new OpenAI({ baseURL, apiKey, timeout: OPENAI_TIMEOUT_MS })
}

export function initClients(): void {
  const nvidiaKeys = NVIDIA_API_KEY
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)

  if (nvidiaKeys.length > 0) {
    clients.nvidiaPool = new NvidiaKeyPool(nvidiaKeys, NVIDIA_BASE_URL)
    console.log(`NVIDIA pool initialized with ${nvidiaKeys.length} key(s)`)
  }

  clients.openai = createClient(OPENAI_BASE_URL, OPENAI_API_KEY)
  clients.kimi = createClient(KIMI_BASE_URL, KIMI_API_KEY)
}

export function getClientByModel(model: string): OpenAI | NvidiaKeyPool | null {
  if (model.startsWith('gpt-')) return clients.openai
  if (model.includes('/')) return clients.nvidiaPool || clients.kimi || clients.openai
  if (model.startsWith('moonshot') || model.startsWith('kimi-')) return clients.kimi
  return clients.nvidiaPool || clients.openai || clients.kimi
}

export async function acquireClient(
  clientOrPool: OpenAI | NvidiaKeyPool | null
): Promise<{ client: OpenAI; entry: any }> {
  if (clientOrPool instanceof NvidiaKeyPool) return await clientOrPool.acquire()
  return { client: clientOrPool!, entry: null }
}
