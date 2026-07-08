import { ref, watch } from 'vue'
import type { Conversation, ChatGroup, Message } from '../types'
import { GROUP_COLORS } from '../types'
import { clearRenderCache } from '../utils/markdown'

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
        .map((c: Conversation) => ({ ...c, id: String(c.id), systemPrompt: c.systemPrompt ?? '', groupId: c.groupId ?? null }))
        .filter((c: Conversation) => c.messages.length > 0 || c.systemPrompt)
    }
  } catch { /* ignore */ }
  return []
}

function saveConversationsNow(convs: Conversation[]) {
  // 只保留有实际内容的会话（有消息或系统提示词）
  // 剥离 images（base64 data URL）以避免 JSON.stringify + localStorage.setItem
  // 在会话数量多时阻塞主线程数秒（visibilitychange 时尤为明显）
  const meaningful = convs
    .filter(c => c.messages.length > 0 || c.systemPrompt)
    .map(c => {
      const hasBlocks = c.messages.some(message => message.blocks?.length)
      const stripped: Conversation = {
        ...c,
        messages: c.messages.map(m => ({
          ...m,
          images: undefined,
        })),
        ...(hasBlocks ? { schemaVersion: 2 as const } : {}),
      }
      return stripped
    })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meaningful))
  } catch (err) {
    // QuotaExceededError 或隐私模式：静默失败，避免阻塞流式更新
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      console.warn('[chat] localStorage 配额已满，跳过持久化会话')
    } else {
      console.warn('[chat] saveConversations failed', err)
    }
  }
}

// 流式输出期间每个 delta 都会触发 deep watcher，用 debounce 合并写入，避免高频 JSON.stringify
let saveConversationsTimer: ReturnType<typeof setTimeout> | null = null
function saveConversations(_convs: Conversation[]) {
  if (saveConversationsTimer !== null) clearTimeout(saveConversationsTimer)
  saveConversationsTimer = setTimeout(() => {
    saveConversationsTimer = null
    // 始终持久化最新状态，而不是回调时捕获的快照
    saveConversationsNow(conversations.value)
  }, 500)
}

// 页面隐藏/关闭时立即刷写挂起的 debounce，避免在 500ms 窗口内丢失最近的会话改动
function flushPendingSave() {
  if (saveConversationsTimer !== null) {
    clearTimeout(saveConversationsTimer)
    saveConversationsTimer = null
    saveConversationsNow(conversations.value)
  }
}

function loadActiveId(): string | null {
  const raw = localStorage.getItem(ACTIVE_KEY)
  if (raw) {
    // 确保该 ID 对应的会话确实存在（统一按字符串比较，兼容历史数字 ID）
    if (conversations.value.some(c => c.id === raw)) return raw
  }
  return conversations.value[0]?.id ?? null
}

function saveActiveId(id: string | null) {
  if (id !== null) {
    localStorage.setItem(ACTIVE_KEY, id)
  } else {
    localStorage.removeItem(ACTIVE_KEY)
  }
}

function createInitialConversation(): Conversation {
  const id = crypto.randomUUID()
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
export const activeConversationId = ref<string | null>(loadActiveId() ?? conversations.value[0].id)
export const groups = ref<ChatGroup[]>(loadGroups())

watch(conversations, saveConversations, { deep: true })
watch(groups, saveGroups, { deep: true })
watch(activeConversationId, (newId, oldId) => {
  saveActiveId(newId)
  if (oldId != null) {
    cleanupEmptyConversation(oldId)
  }
})

function cleanupEmptyConversation(id: string) {
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
    id: crypto.randomUUID(),
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

export function deleteConversation(id: string) {
  const idx = conversations.value.findIndex(c => c.id === id)
  if (idx === -1) return
  conversations.value.splice(idx, 1)
  // 释放被删除会话对应的 markdown 渲染缓存，避免内存泄漏
  clearRenderCache()
  if (activeConversationId.value === id) {
    activeConversationId.value = conversations.value[0]?.id ?? null
    if (!conversations.value.length) {
      createConversation()
    }
  }
}

export function switchConversation(id: string) {
  activeConversationId.value = id
}

export function updateConversationTitle(id: string, messages: Message[]) {
  const conv = conversations.value.find(c => c.id === id)
  if (!conv || conv.title !== 'New Chat') return
  const firstUser = messages.find(m => m.role === 'user')
  if (firstUser) {
    conv.title = firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '…' : '')
  }
}

export function setConversationTitle(id: string, title: string) {
  const conv = conversations.value.find(c => c.id === id)
  if (conv) conv.title = title
}

export function updateSystemPrompt(id: string, prompt: string) {
  const conv = conversations.value.find(c => c.id === id)
  if (conv) conv.systemPrompt = prompt
}

export function touchConversation(id: string) {
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

export function assignToGroup(convId: string, groupId: string | null) {
  const conv = conversations.value.find(c => c.id === convId)
  if (conv) conv.groupId = groupId
}

// 页面真正卸载时刷写挂起的持久化，防止 debounce 窗口内的改动丢失。
// visibilitychange 只代表切到后台，保留 debounce 可避免在该事件中同步序列化大量会话。
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingSave)
  window.addEventListener('pagehide', flushPendingSave)
}
