import { ref, watch } from 'vue'
import type { Conversation, ChatGroup, Message } from '../types'
import { GROUP_COLORS } from '../types'

const STORAGE_KEY = 'recho-conversations'
const GROUPS_KEY = 'recho-groups'
const ACTIVE_KEY = 'recho-active-conversation'

function loadGroups(): ChatGroup[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveGroups(g: ChatGroup[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(g))
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      return data
        .map((c: Conversation) => ({ ...c, systemPrompt: c.systemPrompt ?? '', groupId: c.groupId ?? null }))
        .filter((c: Conversation) => c.messages.length > 0 || c.systemPrompt)
    }
  } catch { /* ignore */ }
  return []
}

function saveConversations(convs: Conversation[]) {
  // 只保留有实际内容的会话（有消息或系统提示词）
  const meaningful = convs
    .filter(c => c.messages.length > 0 || c.systemPrompt)
    .map(c => {
      const hasBlocks = c.messages.some(message => message.blocks?.length)
      return hasBlocks ? { ...c, schemaVersion: 2 as const } : c
    })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meaningful))
}

function loadActiveId(): number | null {
  const raw = localStorage.getItem(ACTIVE_KEY)
  if (raw) {
    const id = Number(raw)
    // 确保该 ID 对应的会话确实存在
    if (conversations.value.some(c => c.id === id)) return id
  }
  return conversations.value[0]?.id ?? null
}

function saveActiveId(id: number | null) {
  if (id !== null) {
    localStorage.setItem(ACTIVE_KEY, String(id))
  } else {
    localStorage.removeItem(ACTIVE_KEY)
  }
}

function createInitialConversation(): Conversation {
  const id = Date.now()
  return {
    id,
    title: 'New Chat',
    messages: [],
    systemPrompt: '',
    groupId: null,
    createdAt: new Date().toLocaleString(),
    updatedAt: new Date().toLocaleString(),
  }
}

const initial = loadConversations()
export const conversations = ref<Conversation[]>(initial.length > 0 ? initial : [createInitialConversation()])
export const activeConversationId = ref<number | null>(loadActiveId() ?? conversations.value[0].id)
export const groups = ref<ChatGroup[]>(loadGroups())

watch(conversations, saveConversations, { deep: true })
watch(groups, saveGroups, { deep: true })
watch(activeConversationId, (newId, oldId) => {
  saveActiveId(newId)
  if (oldId != null) {
    cleanupEmptyConversation(oldId)
  }
})

function cleanupEmptyConversation(id: number) {
  const conv = conversations.value.find(c => c.id === id)
  if (!conv) return
  if (conv.messages.length > 0 || conv.systemPrompt) return
  if (conversations.value.length <= 1) return
  const idx = conversations.value.findIndex(c => c.id === id)
  if (idx !== -1) conversations.value.splice(idx, 1)
}

export function getActiveConversation(): Conversation | undefined {
  return conversations.value.find(c => c.id === activeConversationId.value)
}

export function createConversation(): Conversation {
  const conv: Conversation = {
    id: Date.now(),
    title: 'New Chat',
    messages: [],
    systemPrompt: '',
    groupId: null,
    createdAt: new Date().toLocaleString(),
    updatedAt: new Date().toLocaleString(),
  }
  conversations.value.unshift(conv)
  activeConversationId.value = conv.id
  return conv
}

export function deleteConversation(id: number) {
  const idx = conversations.value.findIndex(c => c.id === id)
  if (idx === -1) return
  conversations.value.splice(idx, 1)
  if (activeConversationId.value === id) {
    activeConversationId.value = conversations.value[0]?.id ?? null
    if (!conversations.value.length) {
      createConversation()
    }
  }
}

export function switchConversation(id: number) {
  activeConversationId.value = id
}

export function updateConversationTitle(id: number, messages: Message[]) {
  const conv = conversations.value.find(c => c.id === id)
  if (!conv || conv.title !== 'New Chat') return
  const firstUser = messages.find(m => m.role === 'user')
  if (firstUser) {
    conv.title = firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '…' : '')
  }
}

export function setConversationTitle(id: number, title: string) {
  const conv = conversations.value.find(c => c.id === id)
  if (conv) conv.title = title
}

export function updateSystemPrompt(id: number, prompt: string) {
  const conv = conversations.value.find(c => c.id === id)
  if (conv) conv.systemPrompt = prompt
}

export function touchConversation(id: number) {
  const conv = conversations.value.find(c => c.id === id)
  if (conv) conv.updatedAt = new Date().toLocaleString()
}

// --- group operations ---

export function createGroup(name: string, color?: string): ChatGroup {
  const usedColors = new Set(groups.value.map(g => g.color))
  const c = color || GROUP_COLORS.find(c => !usedColors.has(c)) || GROUP_COLORS[0]
  const group: ChatGroup = { id: crypto.randomUUID?.() || Date.now().toString(), name, color: c }
  groups.value.push(group)
  return group
}

export function deleteGroup(id: string) {
  // 将该分组下的会话移回未分组
  for (const conv of conversations.value) {
    if (conv.groupId === id) conv.groupId = null
  }
  groups.value = groups.value.filter(g => g.id !== id)
}

export function renameGroup(id: string, name: string) {
  const g = groups.value.find(g => g.id === id)
  if (g) g.name = name
}

export function recolorGroup(id: string, color: string) {
  const g = groups.value.find(g => g.id === id)
  if (g) g.color = color
}

export function assignToGroup(convId: number, groupId: string | null) {
  const conv = conversations.value.find(c => c.id === convId)
  if (conv) conv.groupId = groupId
}
