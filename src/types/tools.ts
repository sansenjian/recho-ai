export type ToolStatus = 'running' | 'done' | 'error' | 'timeout' | 'cancelled'

export type RunState = 'thinking' | 'streaming' | 'tool_executing' | 'idle'

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: string
  isError?: boolean
  status?: ToolStatus
  startedAt?: number
  completedAt?: number
}

export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatEvent =
  | { type: 'delta'; content: string }
  | { type: 'content_start'; blockType: 'text' | 'tool_use'; blockId: string; toolName?: string; toolUseId?: string }
  | { type: 'content_delta'; blockId: string; text?: string; toolInput?: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; status?: ToolStatus }
  | { type: 'tool_result'; id: string; name: string; result: string; isError?: boolean }
  | { type: 'tool_end'; id?: string; status?: ToolStatus }
  | { type: 'status'; state: RunState; label?: string }
  | { type: 'message_complete'; finishReason?: string; incomplete?: boolean }
  | { type: 'done' }
  | { type: 'error'; error: string }
