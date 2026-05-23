import { ref } from 'vue'
import type { ChatMessage } from '../types/events'
import type { RunState, ToolStatus } from '../types/tools'
import SSEClient from '../workers/sse-parser.worker?worker'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const STREAM_IDLE_TIMEOUT_MS = 90_000

interface StreamCallbacks {
  onDelta: (content: string) => void
  onContentStart?: (blockType: 'text' | 'tool_use', blockId: string, toolName?: string, toolUseId?: string) => void
  onContentDelta?: (blockId: string, text?: string, toolInput?: string) => void
  onThinkingDelta?: (content: string) => void
  onToolCall: (id: string, name: string, args: Record<string, unknown>, status?: ToolStatus) => void
  onToolResult: (id: string, name: string, result: string, isError?: boolean) => void
  onToolEnd: (id?: string, status?: ToolStatus) => void
  onStatus?: (state: RunState, label?: string) => void
  onMessageComplete?: (event: { finishReason?: string; incomplete?: boolean }) => void
}

export function useStream() {
  const isStreaming = ref(false)

  async function streamChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    skill?: string | null,
    model?: string,
  ): Promise<void> {
    isStreaming.value = true
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, skill }),
        signal,
      })

      if (!res.ok) {
        let errText = res.statusText
        try {
          const errJson = await res.json()
          errText = errJson.error || res.statusText
        } catch { /* ignore */ }
        throw new Error(errText)
      }

      if (!res.body) {
        throw new Error('response body is empty')
      }

      const worker = new SSEClient()
      const reader = res.body.getReader()
      let idleTimer: number | null = null
      let settled = false
      let resolveStreamDone: (() => void) | null = null
      let rejectStreamDone: ((error: Error) => void) | null = null

      function clearIdleTimer() {
        if (idleTimer === null) return
        window.clearTimeout(idleTimer)
        idleTimer = null
      }

      function refreshIdleTimer() {
        if (settled) return
        clearIdleTimer()
        idleTimer = window.setTimeout(() => {
          rejectOnce(new Error('stream idle timeout'))
        }, STREAM_IDLE_TIMEOUT_MS)
      }

      function resolveOnce() {
        if (settled) return
        settled = true
        clearIdleTimer()
        worker.terminate()
        resolveStreamDone?.()
      }

      function rejectOnce(error: Error) {
        if (settled) return
        settled = true
        clearIdleTimer()
        worker.terminate()
        reader.cancel(error).catch(() => {})
        rejectStreamDone?.(error)
      }

      const streamDone = new Promise<void>((resolve, reject) => {
        resolveStreamDone = resolve
        rejectStreamDone = reject
      })
      streamDone.catch(() => {})

      worker.onmessage = (e: MessageEvent<{
        type: string
        id?: string
        content?: string
        blockId?: string
        blockType?: 'text' | 'tool_use'
        toolName?: string
        toolUseId?: string
        text?: string
        toolInput?: string
        state?: RunState
        label?: string
        name?: string
        arguments?: Record<string, unknown>
        result?: string
        isError?: boolean
        status?: ToolStatus
        finishReason?: string
        incomplete?: boolean
        error?: string
      }>) => {
        const d = e.data
        refreshIdleTimer()
        if (d.type === 'tool_call') {
          callbacks.onToolCall(d.id || '', d.name || '?', d.arguments || {}, d.status)
        } else if (d.type === 'tool_result') {
          callbacks.onToolResult(d.id || '', d.name || '?', d.result || '', d.isError)
        } else if (d.type === 'tool_end') {
          callbacks.onToolEnd(d.id, d.status)
        } else if (d.type === 'status') {
          callbacks.onStatus?.(d.state || 'thinking', d.label)
        } else if (d.type === 'content_start') {
          callbacks.onContentStart?.(d.blockType || 'text', d.blockId || '', d.toolName, d.toolUseId)
        } else if (d.type === 'content_delta') {
          callbacks.onContentDelta?.(d.blockId || '', d.text, d.toolInput)
          if (d.text) callbacks.onDelta(d.text)
        } else if (d.type === 'message_complete') {
          callbacks.onMessageComplete?.({ finishReason: d.finishReason, incomplete: d.incomplete })
        } else if (d.type === 'thinking_delta' && d.content) {
          callbacks.onThinkingDelta?.(d.content)
        } else if (d.type === 'delta' && d.content) {
          callbacks.onDelta(d.content)
        } else if (d.type === 'done') {
          resolveOnce()
        } else if (d.type === 'error') {
          rejectOnce(new Error(d.error || 'stream error'))
        }
      }
      worker.onerror = () => { rejectOnce(new Error('SSE parser worker failed')) }
      refreshIdleTimer()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value.byteLength > 0) {
            refreshIdleTimer()
          }
          const data = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
          worker.postMessage({ type: 'chunk', data }, [data])
        }
      } finally {
        reader.releaseLock()
        if (!settled) {
          refreshIdleTimer()
          try { worker.postMessage({ type: 'flush' }) } catch { resolveOnce() }
        }
        await streamDone
      }
    } finally {
      isStreaming.value = false
    }
  }

  return { isStreaming, streamChat }
}
