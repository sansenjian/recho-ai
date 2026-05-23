<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import type { Message } from './types'
import { AGENT_MODES, AVAILABLE_MODELS } from './types'
import {
  activeConversationId,
  getActiveConversation,
  createConversation,
  updateSystemPrompt,
} from './stores/chat'
import { useChatLoop } from './composables/useChatLoop'
import { useMemory } from './composables/useMemory'
import { extractThinking, getRendered } from './utils/markdown'
import { relativeTime } from './utils/time'
import ChatHeader from './components/ChatHeader.vue'
import ChatMessage from './components/ChatMessage.vue'
import ChatInput from './components/ChatInput.vue'
import ChatSidebar from './components/ChatSidebar.vue'
import AgentWorkspace from './components/AgentWorkspace.vue'
import ToolActivity from './components/ToolActivity.vue'
import StreamingStatus from './components/StreamingStatus.vue'
import ThinkingActivity from './components/ThinkingActivity.vue'

// --- Composables ---
const { isLoading, runState, runStatusLabel, activeToolCalls, completedToolCalls, submitMessage, stopGeneration } = useChatLoop()
// Memory system initialized for future use
useMemory()

// --- Model ---
const currentModel = ref(AVAILABLE_MODELS[0])
const currentAgentMode = ref(AGENT_MODES[1])

// --- Messages ---
const messages = computed<Message[]>(() => {
  return getActiveConversation()?.messages ?? []
})

const latestAssistantMessageId = computed(() => {
  return [...messages.value].reverse().find(msg => msg.role === 'assistant')?.id ?? null
})

const hasToolActivity = computed(() => {
  return activeToolCalls.value.length > 0 || completedToolCalls.value.length > 0
})

function toolCallsForMessage(msg: Message) {
  const savedToolCalls = msg.toolCalls ?? []
  const shouldUseLiveTools = (
    msg.id === latestAssistantMessageId.value &&
    hasToolActivity.value &&
    savedToolCalls.length === 0
  )

  if (shouldUseLiveTools) {
    return {
      active: activeToolCalls.value,
      completed: completedToolCalls.value,
    }
  }

  return {
    active: [],
    completed: savedToolCalls,
  }
}

function messageHasTools(msg: Message) {
  if (msg.blocks?.some(block => block.type === 'tool_use')) return false
  const calls = toolCallsForMessage(msg)
  return calls.active.length > 0 || calls.completed.length > 0
}

function thinkingForMessage(msg: Message) {
  if (msg.blocks?.some(block => block.type === 'thinking')) return ''
  return msg.thinking || extractThinking(msg.content)
}

// --- Sidebar ---
const showSidebar = ref(false)
const showAgentPanel = ref(true)
function toggleSidebar() { showSidebar.value = !showSidebar.value }
function closeSidebar() { showSidebar.value = false }
function toggleAgentPanel() { showAgentPanel.value = !showAgentPanel.value }

// --- System prompt editor ---
const showSystemEditor = ref(false)
const systemPromptDraft = ref('')

function toggleSystemEditor() {
  if (!showSystemEditor.value) {
    systemPromptDraft.value = getActiveConversation()?.systemPrompt ?? ''
  }
  showSystemEditor.value = !showSystemEditor.value
}

function saveSystemPrompt() {
  const convId = activeConversationId.value
  if (convId) {
    updateSystemPrompt(convId, systemPromptDraft.value)
  }
  showSystemEditor.value = false
}

function closeSystemEditor() { showSystemEditor.value = false }

// --- Skills ---
interface SkillOption { name: string; description: string; icon: string }
const skills = ref<SkillOption[]>([])
const activeSkill = ref<string | null>(null)

async function fetchSkills() {
  try {
    const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
    const res = await fetch(`${API_BASE}/api/skills`)
    if (res.ok) {
      const data = await res.json()
      skills.value = data.skills || []
    }
  } catch { /* ignore */ }
}

function selectSkill(name: string | null) { activeSkill.value = name }

// --- Image upload ---
const pendingImages = ref<string[]>([])
const isDragOver = ref(false)
let dragCounter = 0

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('not an image'))
    const img = new Image()
    img.onload = () => {
      const maxWidth = 1280
      const scale = Math.min(maxWidth / img.width, 1)
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('load failed')) }
    img.src = URL.createObjectURL(file)
  })
}

async function addFiles(files: FileList | File[]) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    try {
      const b64 = await fileToBase64(f)
      pendingImages.value = [...pendingImages.value, b64]
    } catch { /* skip */ }
  }
}

function removePendingImage(index: number) {
  pendingImages.value = pendingImages.value.filter((_, i) => i !== index)
}

function triggerFileInput() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => { if (input.files) addFiles(input.files) }
  input.click()
}

// --- Drag & drop ---
function onDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; if (dragCounter === 1) isDragOver.value = true }
function onDragLeave(_e: DragEvent) { dragCounter--; if (dragCounter === 0) isDragOver.value = false }
function onDragOver(e: DragEvent) { e.preventDefault() }
function onDrop(e: DragEvent) {
  e.preventDefault(); dragCounter = 0; isDragOver.value = false
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files)
}
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) addFiles(files)
}

// --- Submit ---
async function handleSubmit(value: string) {
  await submitMessage(
    value,
    currentModel.value.id,
    pendingImages.value.length > 0 ? [...pendingImages.value] : undefined,
    activeSkill.value,
    currentAgentMode.value,
  )
  pendingImages.value = []
  activeSkill.value = null
}

function handleStop() { stopGeneration() }

// --- Copy / Retry ---
const copyFeedbackId = ref<number | null>(null)
async function handleCopy(msg: Message) {
  try {
    await navigator.clipboard.writeText(msg.content)
    copyFeedbackId.value = msg.id
    setTimeout(() => { if (copyFeedbackId.value === msg.id) copyFeedbackId.value = null }, 1500)
  } catch { /* denied */ }
}

function handleRetry(msg: Message) {
  if (msg.images?.length) pendingImages.value = [...msg.images]
  handleSubmit(msg.content)
}

// --- Scroll ---
const chatAreaRef = ref<HTMLElement | null>(null)
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
  if (messages.value[messages.value.length - 1]?.role === 'assistant') scrollToBottom()
})
watch(activeConversationId, () => { showSystemEditor.value = false; scrollToBottom() })
watch(isLoading, (v) => { scrollSmooth = !v })

// --- Keyboard ---
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key === 'k') { e.preventDefault(); createConversation(); showSidebar.value = false }
  if (e.key === 'Escape') {
    if (showSystemEditor.value) showSystemEditor.value = false
    else if (showSidebar.value) showSidebar.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('paste', onPaste)
  fetchSkills()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onPaste)
  stopGeneration()
})

function handleChangeModel(m: typeof AVAILABLE_MODELS[number]) { currentModel.value = m }
function handleNewChat() { createConversation(); showSidebar.value = false }
</script>

<template>
  <div
    class="app-shell"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div v-if="isDragOver" class="drag-overlay">
      <div class="drag-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="40" height="40">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span>拖放图片到此处</span>
      </div>
    </div>
    <div v-if="showSidebar" class="sidebar-backdrop" @click="closeSidebar" />
    <ChatSidebar v-if="showSidebar" @close="closeSidebar" />

    <div class="chat-layout">
      <ChatHeader
        :show-sidebar="showSidebar"
        :show-agent-panel="showAgentPanel"
        :agent-mode="currentAgentMode"
        :messages="messages"
        @toggle-sidebar="toggleSidebar"
        @toggle-agent-panel="toggleAgentPanel"
        @new-chat="handleNewChat"
        @toggle-settings="toggleSystemEditor"
      />

      <div v-if="showSystemEditor" class="system-editor-panel">
        <div class="system-editor-header">
          <span class="system-editor-title">系统提示词</span>
          <button class="system-editor-close" @click="closeSystemEditor">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <textarea
          v-model="systemPromptDraft"
          class="system-editor-textarea"
          placeholder="输入系统提示词..."
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
            <ThinkingActivity
              v-if="msg.role === 'assistant' && thinkingForMessage(msg)"
              :content="thinkingForMessage(msg)"
              :active="msg.id === latestAssistantMessageId && isLoading"
            />

            <ToolActivity
              v-if="msg.role === 'assistant' && messageHasTools(msg)"
              embedded
              :active-tool-calls="toolCallsForMessage(msg).active"
              :completed-tool-calls="toolCallsForMessage(msg).completed"
            />

            <StreamingStatus
              v-if="msg.id === latestAssistantMessageId"
              :is-loading="isLoading && !msg.content"
              :active-tool-calls="activeToolCalls"
              :state="runState"
              :label="runStatusLabel"
            />

            <ChatMessage
              :msg="{ ...msg, timestamp: relativeTime(msg.timestamp) }"
              :rendered="getRendered(msg)"
              :copy-feedback="copyFeedbackId === msg.id"
              @copy="handleCopy(msg)"
              @retry="handleRetry(msg)"
            />
          </div>

        </div>
      </main>

      <ChatInput
        :is-loading="isLoading"
        :current-model="currentModel"
        :models="AVAILABLE_MODELS"
        :pending-images="pendingImages"
        :skills="skills"
        :active-skill="activeSkill"
        @submit="handleSubmit"
        @stop="handleStop"
        @change-model="handleChangeModel"
        @remove-image="removePendingImage"
        @upload="triggerFileInput"
        @select-skill="selectSkill"
      />
    </div>

    <AgentWorkspace
      v-if="showAgentPanel"
      :modes="AGENT_MODES"
      :active-mode="currentAgentMode"
      :skills="skills"
      :active-skill="activeSkill"
      :active-tool-calls="activeToolCalls"
      :completed-tool-calls="completedToolCalls"
      @change-mode="currentAgentMode = $event"
      @select-skill="selectSkill"
    />
  </div>
</template>

<style scoped>
.app-shell { display: flex; height: 100vh; background: #fff; position: relative; }
.sidebar-backdrop { display: none; }
.chat-layout { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.system-editor-panel { max-width: 720px; margin: 0 auto; width: 100%; padding: 12px 24px; background: #f9f9fb; border-bottom: 1px solid var(--border); }
.system-editor-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.system-editor-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.system-editor-close { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; border-radius: 4px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.system-editor-close:hover { background: var(--hover-bg); color: var(--text-primary); }
.system-editor-textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: #fff; font-size: 13px; font-family: var(--font-sans); line-height: 1.5; color: var(--text-primary); resize: vertical; outline: none; min-height: 80px; }
.system-editor-textarea:focus { border-color: var(--accent); }
.system-editor-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.system-editor-btn { padding: 4px 14px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.system-editor-btn.save { background: var(--accent); color: #fff; border-color: var(--accent); }
.chat-area { flex: 1; overflow-y: auto; padding: 0; }
.messages-container { max-width: 720px; margin: 0 auto; padding: 24px 24px 32px; }
.message-wrapper { margin-bottom: 24px; }
.drag-overlay { position: fixed; inset: 0; background: rgba(99, 102, 241, 0.08); backdrop-filter: blur(4px); z-index: 200; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--accent); border-radius: 16px; margin: 24px; pointer-events: none; }
.drag-hint { display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--accent); font-size: 16px; font-weight: 600; background: #fff; padding: 32px 48px; border-radius: 16px; box-shadow: 0 8px 32px rgba(99, 102, 241, 0.15); }
@media (max-width: 768px) { .sidebar-backdrop { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 50; } .messages-container { padding: 16px 12px 24px; } }
</style>
