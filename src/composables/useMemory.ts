import { ref } from 'vue'

// Claude Code-inspired memory system
// Memory is stored in the Claude memory directory pattern

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryEntry {
  name: string
  description: string
  type: MemoryType
  content: string
  updatedAt: string
}

const STORAGE_KEY = 'recho-memory'

function loadMemories(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveMemories(entries: MemoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function useMemory() {
  const memories = ref<MemoryEntry[]>(loadMemories())

  function addMemory(entry: Omit<MemoryEntry, 'updatedAt'>) {
    const idx = memories.value.findIndex(m => m.name === entry.name)
    const now = new Date().toISOString()
    if (idx !== -1) {
      memories.value[idx] = { ...entry, updatedAt: now }
    } else {
      memories.value.push({ ...entry, updatedAt: now })
    }
    memories.value = [...memories.value]
    saveMemories(memories.value)
  }

  function removeMemory(name: string) {
    memories.value = memories.value.filter(m => m.name !== name)
    saveMemories(memories.value)
  }

  function getMemory(name: string): MemoryEntry | undefined {
    return memories.value.find(m => m.name === name)
  }

  function getMemoriesByType(type: MemoryType): MemoryEntry[] {
    return memories.value.filter(m => m.type === type)
  }

  function clearAll() {
    memories.value = []
    saveMemories(memories.value)
  }

  return {
    memories,
    addMemory,
    removeMemory,
    getMemory,
    getMemoriesByType,
    clearAll,
  }
}
