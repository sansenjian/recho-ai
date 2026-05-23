import { ref } from 'vue'
import type { ToolCall, ToolStatus } from '../types/tools'

export function useTools() {
  const activeToolCalls = ref<ToolCall[]>([])
  const completedToolCalls = ref<ToolCall[]>([])

  function snapshotTools(): ToolCall[] {
    return [
      ...completedToolCalls.value,
      ...activeToolCalls.value,
    ].map(tool => ({ ...tool }))
  }

  function onToolCall(id: string, name: string, args: Record<string, unknown>) {
    activeToolCalls.value = [
      ...activeToolCalls.value,
      { id, name, arguments: args, status: 'running', startedAt: Date.now() },
    ]
  }

  function onToolResult(id: string, _name: string, result: string, isError = false) {
    const idx = activeToolCalls.value.findIndex(t => t.id === id)
    if (idx !== -1) {
      activeToolCalls.value[idx] = {
        ...activeToolCalls.value[idx],
        result,
        isError,
        status: isError ? 'error' : 'done',
        completedAt: Date.now(),
      }
      activeToolCalls.value = [...activeToolCalls.value]
    }
  }

  function onToolEnd(id?: string, status: ToolStatus = 'done') {
    if (id) {
      const idx = activeToolCalls.value.findIndex(t => t.id === id)
      if (idx !== -1) {
        activeToolCalls.value[idx] = {
          ...activeToolCalls.value[idx],
          status,
          isError: status === 'error' || status === 'timeout',
          completedAt: activeToolCalls.value[idx].completedAt || Date.now(),
        }
        activeToolCalls.value = [...activeToolCalls.value]
      }
    }
    // Move active tools to completed instead of clearing
    completedToolCalls.value = [
      ...completedToolCalls.value,
      ...activeToolCalls.value.map(t => ({
        ...t,
        result: t.result || '',
        status: t.status === 'running' ? status : t.status,
        completedAt: t.completedAt || Date.now(),
      })),
    ]
    activeToolCalls.value = []
  }

  function resetTools() {
    activeToolCalls.value = []
    completedToolCalls.value = []
  }

  return { activeToolCalls, completedToolCalls, onToolCall, onToolResult, onToolEnd, resetTools, snapshotTools }
}
