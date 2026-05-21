<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import type { Message } from './types'
import { AVAILABLE_MODELS, DEFAULT_SYSTEM_PROMPT } from './types'
import {
  activeConversationId,
  getActiveConversation,
  createConversation,
  updateConversationTitle,
  setConversationTitle,
  updateSystemPrompt,
  touchConversation,
} from './stores/chat'
import ChatHeader from './components/ChatHeader.vue'
import ChatMessage from './components/ChatMessage.vue'
import ChatInput from './components/ChatInput.vue'
import ChatSidebar from './components/ChatSidebar.vue'
import SSEClient from './workers/sse-parser.worker?worker'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const currentModel = ref(AVAILABLE_MODELS[0])

const messages = computed<Message[]>(() => {
  return getActiveConversation()?.messages ?? []
})

const showSidebar = ref(false)
const showSystemEditor = ref(false)
const systemPromptDraft = ref('')

function toggleSidebar() {
  showSidebar.value = !showSidebar.value
}

function closeSidebar() {
  showSidebar.value = false
}

function toggleSystemEditor() {
  if (!showSystemEditor.value) {
    systemPromptDraft.value = getActiveConversation()?.systemPrompt ?? ''
  }
  showSystemEditor.value = !showSystemEditor.value
}

function saveSystemPrompt() {
  const convId = activeConversationId.value
  if (convId) updateSystemPrompt(convId, systemPromptDraft.value)
  showSystemEditor.value = false
}

function closeSystemEditor() {
  showSystemEditor.value = false
}

const isLoading = ref(false)
const abortController = ref<AbortController | null>(null)
const chatAreaRef = ref<HTMLElement | null>(null)
const copyFeedbackId = ref<number | null>(null)

const md: MarkdownIt = new MarkdownIt({
  breaks: true,
  linkify: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch { /* fallthrough */ }
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`
  },
})

// Per-message rendered HTML cache — avoids re-parsing markdown on every delta
const renderedCache = new Map<number, string>()

function stripThinking(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
}

function getRendered(msg: Message): string | undefined {
  if (msg.role !== 'assistant') return undefined
  const cached = renderedCache.get(msg.id)
  if (cached !== undefined && cached.length >= msg.content.length) return cached
  const html = md.render(stripThinking(msg.content))
  renderedCache.set(msg.id, html)
  return html
}

// --- relative time ---
function relativeTime(ts: string): string {
  if (ts === 'just now') return '刚刚'
  const date = new Date(ts)
  if (isNaN(date.getTime())) return ts
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return ts
}

// --- scroll ---
let scrollSmooth = true
function scrollToBottom() {
  nextTick(() => {
    chatAreaRef.value?.scrollTo({
      top: chatAreaRef.value.scrollHeight,
      behavior: scrollSmooth ? 'smooth' : 'auto',
    })
  })
}

watch(() => messages.value.length, () => scrollToBottom())
watch(() => messages.value[messages.value.length - 1]?.content, () => {
  const last = messages.value[messages.value.length - 1]
  if (last?.role === 'assistant') scrollToBottom()
})
watch(activeConversationId, () => {
  showSystemEditor.value = false
  scrollToBottom()
})

// --- chat submit ---
async function handleSubmit(value: string) {
  if (isLoading.value) return

  const convId = activeConversationId.value
  if (!convId) return

  const conv = getActiveConversation()
  if (!conv) return

  const isFirstExchange = conv.messages.length === 0

  const userMsg: Message = {
    id: Date.now(),
    role: 'user',
    content: value,
    timestamp: new Date().toISOString(),
  }
  conv.messages.push(userMsg)
  touchConversation(convId)

  const assistantMsg: Message = {
    id: Date.now() + 1,
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
  conv.messages.push(assistantMsg)
  isLoading.value = true
  scrollSmooth = false

  const target = conv.messages[conv.messages.length - 1]
  abortController.value = new AbortController()

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel.value.id,
        messages: [
          { role: 'system', content: conv.systemPrompt || DEFAULT_SYSTEM_PROMPT },
          ...conv.messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: abortController.value.signal,
    })

    if (!res.ok) {
      let errText = res.statusText
      try {
        const errJson = await res.json()
        errText = errJson.error || res.statusText
      } catch { /* ignore */ }
      assistantMsg.content = `Error: ${errText}`
      isLoading.value = false
      return
    }

    if (!res.body) {
      assistantMsg.content = 'Error: response body is empty'
      isLoading.value = false
      return
    }

    // SSE Worker 解析
    const worker = new SSEClient()
    const streamDone = new Promise<void>((resolve) => {
      worker.onmessage = (e: MessageEvent<{ type: string; content?: string }>) => {
        if (e.data.type === 'delta' && e.data.content) {
          target.content += e.data.content
          // Pre-render into cache so the template reads avoid re-parsing markdown
          renderedCache.set(target.id, md.render(target.content))
        } else if (e.data.type === 'done') {
          worker.terminate()
          resolve()
        }
      }
      worker.onerror = () => {
        worker.terminate()
        resolve()
      }
    })

    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        worker.postMessage({ type: 'chunk', data: value!.buffer }, [value!.buffer])
      }
    } finally {
      reader.releaseLock()
    }

    // flush: tell worker no more chunks are coming, worker responds with done
    try { worker.postMessage({ type: 'flush' }) } catch { /* worker already terminated */ }
    await streamDone
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      assistantMsg.content += '\n\n[已停止]'
    } else {
      const msg = err instanceof Error ? err.message : '未知错误'
      assistantMsg.content = `Error: ${msg}`
    }
  } finally {
    isLoading.value = false
    abortController.value = null
    scrollSmooth = true
    touchConversation(convId)

    if (isFirstExchange && userMsg.content) {
      updateConversationTitle(convId, conv.messages)
      if (assistantMsg.content && !assistantMsg.content.startsWith('Error')) {
        autoGenerateTitle(convId, userMsg.content, assistantMsg.content)
      }
    }
  }
}

function handleStop() {
  abortController.value?.abort()
}

async function autoGenerateTitle(convId: number, userContent: string, assistantContent: string) {
  try {
    const summaryPrompt = `请基于以下对话内容，用5-10个字简洁总结对话主题。只输出主题文字，不要引号、标点或任何额外解释。

用户：${userContent.slice(0, 200)}
AI：${assistantContent.slice(0, 500)}`

    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel.value.id,
        messages: [
          { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
          { role: 'user', content: summaryPrompt },
        ],
      }),
    })

    if (!res.ok || !res.body) return

    const worker = new SSEClient()
    let title = ''

    const titleDone = new Promise<void>((resolve) => {
      worker.onmessage = (e: MessageEvent<{ type: string; content?: string }>) => {
        if (e.data.type === 'delta' && e.data.content) {
          title += e.data.content
        } else if (e.data.type === 'done') {
          worker.terminate()
          resolve()
        }
      }
      worker.onerror = () => { worker.terminate(); resolve() }
    })

    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        worker.postMessage({ type: 'chunk', data: value!.buffer }, [value!.buffer])
      }
    } finally {
      reader.releaseLock()
    }

    try { worker.postMessage({ type: 'flush' }) } catch { /* worker already terminated */ }
    await titleDone
    title = title.replace(/^["'「」『』【】《》\s]+|["'「」『』【】《》\s]+$/g, '').trim()
    if (title) {
      const final = title.length > 20 ? title.slice(0, 18) + '…' : title
      setConversationTitle(convId, final)
    }
  } catch { /* ignore */ }
}

// --- copy ---
async function handleCopy(msg: Message) {
  try {
    await navigator.clipboard.writeText(msg.content)
    copyFeedbackId.value = msg.id
    setTimeout(() => {
      if (copyFeedbackId.value === msg.id) copyFeedbackId.value = null
    }, 1500)
  } catch { /* clipboard denied */ }
}

function handleRetry(msg: Message) {
  handleSubmit(msg.content)
}

// --- keyboard shortcuts ---
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key === 'k') {
    e.preventDefault()
    createConversation()
    showSidebar.value = false
  }
  if (e.key === 'Escape') {
    if (showSystemEditor.value) showSystemEditor.value = false
    else if (showSidebar.value) showSidebar.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  abortController.value?.abort()
})

function handleChangeModel(m: typeof AVAILABLE_MODELS[number]) {
  currentModel.value = m
}

function handleNewChat() {
  createConversation()
  showSidebar.value = false
}
</script>

<template>
  <div class="app-shell">
    <div v-if="showSidebar" class="sidebar-backdrop" @click="closeSidebar" />
    <ChatSidebar v-if="showSidebar" @close="closeSidebar" />

    <div class="chat-layout">
      <ChatHeader
        :show-sidebar="showSidebar"
        @toggle-sidebar="toggleSidebar"
        @new-chat="handleNewChat"
        @toggle-settings="toggleSystemEditor"
      />

      <div v-if="showSystemEditor" class="system-editor-panel">
        <div class="system-editor-header">
          <span class="system-editor-title">系统提示词</span>
          <button class="system-editor-close" @click="closeSystemEditor">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <textarea
          v-model="systemPromptDraft"
          class="system-editor-textarea"
          placeholder="输入系统提示词，例如：你是一个专业的编程助手..."
          rows="4"
          @keydown.escape="closeSystemEditor"
        />
        <div class="system-editor-actions">
          <button class="system-editor-btn cancel" @click="showSystemEditor = false">取消</button>
          <button class="system-editor-btn save" @click="saveSystemPrompt">保存</button>
        </div>
      </div>

      <main ref="chatAreaRef" class="chat-area">
        <div class="messages-container">
          <div v-for="msg in messages" :key="msg.id" class="message-wrapper">
            <ChatMessage
              :msg="{ ...msg, timestamp: relativeTime(msg.timestamp) }"
              :rendered="getRendered(msg)"
              :copy-feedback="copyFeedbackId === msg.id"
              @copy="handleCopy(msg)"
              @retry="handleRetry(msg)"
            />
          </div>

          <div v-if="isLoading && !messages[messages.length - 1]?.content" class="loading-indicator">
            <svg viewBox="0 0 24 24" width="20" height="20" class="spinner">
              <circle cx="12" cy="12" r="10" fill="none" stroke="#6366f1" stroke-width="2" stroke-dasharray="30 70" stroke-linecap="round" />
            </svg>
          </div>
        </div>
      </main>

      <ChatInput
        :is-loading="isLoading"
        :current-model="currentModel"
        :models="AVAILABLE_MODELS"
        @submit="handleSubmit"
        @stop="handleStop"
        @change-model="handleChangeModel"
      />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  background: #fff;
  position: relative;
}

.sidebar-backdrop {
  display: none;
}

.chat-layout {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.system-editor-panel {
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  padding: 12px 24px;
  background: #f9f9fb;
  border-bottom: 1px solid var(--border);
}

.system-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.system-editor-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.system-editor-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.system-editor-close:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.system-editor-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  font-family: var(--font-sans);
  line-height: 1.5;
  color: var(--text-primary);
  resize: vertical;
  outline: none;
  min-height: 80px;
}

.system-editor-textarea:focus { border-color: var(--accent); }
.system-editor-textarea::placeholder { color: #b0b0be; }

.system-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.system-editor-btn {
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

.system-editor-btn.save {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.messages-container {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 24px 32px;
}

.message-wrapper { margin-bottom: 24px; }

.loading-indicator {
  padding: 8px 0 8px 40px;
}

.spinner {
  animation: spin 1.2s linear infinite;
  color: #f97316;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* mobile */
@media (max-width: 768px) {
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 50;
  }
  .messages-container {
    padding: 16px 12px 24px;
  }
}
</style>
