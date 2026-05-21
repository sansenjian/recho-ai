export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface ChatGroup {
  id: string
  name: string
  color: string
}

export const GROUP_COLORS = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
]

export interface Conversation {
  id: number
  title: string
  messages: Message[]
  systemPrompt: string
  groupId: string | null
  createdAt: string
  updatedAt: string
}

export type AbortControllerRef = { value: AbortController | null }

export interface ModelOption {
  id: string
  provider: string
  label: string
  level: string
}

export const DEFAULT_SYSTEM_PROMPT = '请直接、简洁地回答用户的问题。不要使用"首先/让我来/好的，我来"等开场白，不要重复或总结用户的问题，直接从答案开始。'

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'moonshotai/kimi-k2.6', provider: 'Kimi', label: 'Kimi-K2.6', level: '高' },
  { id: 'moonshotai/kimi-k2.5', provider: 'Kimi', label: 'Kimi-K2.5', level: '中' },
  { id: 'gpt-4o', provider: 'OpenAI', label: 'GPT-4o', level: '高' },
  { id: 'gpt-4o-mini', provider: 'OpenAI', label: 'GPT-4o-mini', level: '低' },
]
