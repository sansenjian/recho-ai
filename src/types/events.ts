import type { ToolCall } from './tools'

export interface VisionContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface ChatMessage {
  role: string
  content: string | VisionContent[]
}

export interface ToolStatusState {
  activeToolCalls: ToolCall[]
}
