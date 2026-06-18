<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Message } from '../types'
import { AGENT_MODES, AVAILABLE_MODELS } from '../types'
import {
  activeConversationId,
  getActiveConversation,
  createConversation,
  updateSystemPrompt,
} from '../stores/chat'
import { useChatLoop } from '../composables/useChatLoop'
import { useMemory } from '../composables/useMemory'
import { extractThinking } from '../utils/messageText'
import { relativeTime } from '../utils/time'
import ChatHeader from '../components/ChatHeader.vue'
import ChatSidebar from '../components/ChatSidebar.vue'
import ToolActivity from '../components/ToolActivity.vue'
import StreamingStatus from '../components/StreamingStatus.vue'
import ThinkingActivity from '../components/ThinkingActivity.vue'
import AnnouncementPopup from '../components/AnnouncementPopup.vue'
import { useAuthSession } from '../composables/useAuthSession'
import { useAnnouncementPopup } from '../composables/useAnnouncementPopup'
import { useCredits } from '../composables/useCredits'
import { apiUrl } from '../lib/api-base'
import { hasFileTransfer } from '../lib/image-canvas-utils'
import { formatCreditAmount } from '../utils/credit-format'
import type { RouteWorkspace } from '../router'

type ImageWorkspace = 'canvas' | 'gallery'

const AgentWorkspace = defineAsyncComponent(() => import('../components/AgentWorkspace.vue'))
const ChatInput = defineAsyncComponent(() => import('../components/ChatInput.vue'))
const ChatMessage = defineAsyncComponent(() => import('../components/ChatMessage.vue'))
const ImageCanvas = defineAsyncComponent(() => import('../components/ImageCanvas.vue'))
// ImagioView is now used internally by ImageCanvas component
// const ImagioView = defineAsyncComponent(() => import('../components/ImagioView.vue'))

// --- Composables ---
const { isLoading, runState, runStatusLabel, activeToolCalls, completedToolCalls, submitMessage, stopGeneration } = useChatLoop()
const {
  user,
  userEmail,
  authError,
  authNotice,
  isAuthReady,
  isAuthLoading,
  initAuth,
  submitAuth,
  signInWithGitHub,
  signOut,
} = useAuthSession()
const {
  creditBalance,
  isLoadingCredits,
  isRedeemingCredits,
  creditError,
  creditNotice,
  redeemCredits,
} = useCredits()
const {
  announcement,
  shouldShowAnnouncement,
  fetchLatestAnnouncement,
  markAnnouncementRead,
} = useAnnouncementPopup()
// Memory system initialized for future use
useMemory()

const route = useRoute()
const router = useRouter()

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
const showAgentPanel = ref(false)
const showImagePanel = ref(true)
const imageWorkspace = ref<ImageWorkspace>('canvas')
const isMobile = () => (typeof window !== 'undefined' ? window.innerWidth < 768 : false)
const imageMode = ref<'imagio' | 'canvas'>(isMobile() ? 'imagio' : 'canvas')
function toggleSidebar() { showSidebar.value = !showSidebar.value }
function closeSidebar() { showSidebar.value = false }

function currentRouteWorkspace(): RouteWorkspace {
  const workspace = route.meta.workspace
  return workspace === 'chat' || workspace === 'works' || workspace === 'image' ? workspace : 'image'
}

function requireChatAccess(nextPath = '/chat') {
  if (user.value) return true
  pendingAuthPath.value = nextPath
  openAuthDialog('signIn')
  return false
}

function syncWorkspaceFromRoute() {
  const workspace = currentRouteWorkspace()
  if (workspace === 'chat' && !user.value) {
    showImagePanel.value = true
    showAgentPanel.value = false
    imageWorkspace.value = 'canvas'
    imageMode.value = 'imagio'
    if (isAuthReady.value) {
      pendingAuthPath.value = '/chat'
      openAuthDialog('signIn')
      void router.replace('/image')
    }
    return
  }

  showImagePanel.value = workspace !== 'chat'
  showAgentPanel.value = false
  imageWorkspace.value = workspace === 'works' ? 'gallery' : 'canvas'
  if (workspace === 'image') {
    imageMode.value = isMobile() ? 'imagio' : 'canvas'
  }
  if (workspace !== 'chat') {
    showSystemEditor.value = false
  }
}

async function toggleAgentPanel() {
  if (currentRouteWorkspace() !== 'chat') {
    if (!requireChatAccess('/chat')) return
    await router.push('/chat')
  }
  showAgentPanel.value = !showAgentPanel.value
}
function toggleImagePanel() {
  if (currentRouteWorkspace() === 'chat') {
    void router.push('/image')
    return
  }
  if (!requireChatAccess('/chat')) return
  void router.push('/chat')
}

// --- System prompt editor ---
const showSystemEditor = ref(false)
const systemPromptDraft = ref('')

function toggleSystemEditor() {
  if (showImagePanel.value) return
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
    const res = await fetch(apiUrl('/api/skills'))
    if (res.ok) {
      const data = await res.json()
      skills.value = data.skills || []
    }
  } catch { /* ignore */ }
}

function selectSkill(name: string | null) { activeSkill.value = name }

// --- Auth ---
type AuthMode = 'signIn' | 'signUp'
const showAuthDialog = ref(false)
const authMode = ref<AuthMode>('signIn')
const authEmailDraft = ref('')
const authPasswordDraft = ref('')
const redeemCodeDraft = ref('')
const pendingAuthPath = ref<string | null>(null)
const creditBalanceLabel = computed(() => (
  isLoadingCredits.value && creditBalance.value === null
    ? '...'
    : formatCreditAmount(creditBalance.value)
))

function openAuthDialog(mode: AuthMode = 'signIn') {
  authMode.value = mode
  authEmailDraft.value = userEmail.value
  authPasswordDraft.value = ''
  showAuthDialog.value = true
}

function closeAuthDialog() {
  pendingAuthPath.value = null
  showAuthDialog.value = false
}

async function handleAuthSubmit() {
  const ok = await submitAuth(authMode.value, authEmailDraft.value, authPasswordDraft.value)
  if (ok && authMode.value === 'signIn') {
    const nextPath = pendingAuthPath.value
    pendingAuthPath.value = null
    showAuthDialog.value = false
    if (nextPath) {
      void router.push(nextPath)
    }
  }
}

async function handleGitHubAuth() {
  const ok = await signInWithGitHub(pendingAuthPath.value || route.fullPath || '/image')
  if (ok) {
    showAuthDialog.value = false
  }
}

async function handleSignOut() {
  await signOut()
  showAuthDialog.value = false
}

async function handleRedeemCredits() {
  const ok = await redeemCredits(redeemCodeDraft.value)
  if (ok) {
    redeemCodeDraft.value = ''
  }
}

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
function suppressWorksFileDrag(e: DragEvent) {
  if (currentRouteWorkspace() !== 'works' || !hasFileTransfer(e)) return false
  e.preventDefault()
  dragCounter = 0
  isDragOver.value = false
  return true
}

function onDragEnter(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  if (showImagePanel.value) return
  e.preventDefault()
  dragCounter++
  if (dragCounter === 1) isDragOver.value = true
}
function onDragLeave(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  if (showImagePanel.value) return
  dragCounter--
  if (dragCounter === 0) isDragOver.value = false
}
function onDragOver(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  if (showImagePanel.value) return
  e.preventDefault()
}
function onDrop(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  if (showImagePanel.value) return
  e.preventDefault()
  dragCounter = 0
  isDragOver.value = false
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files)
}
function onPaste(e: ClipboardEvent) {
  if (showImagePanel.value) return
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
  if (!requireChatAccess('/chat')) return
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
watch([() => route.meta.workspace, () => user.value?.id || null, isAuthReady], () => {
  syncWorkspaceFromRoute()
}, { immediate: true })

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
  void fetchLatestAnnouncement()
  void initAuth()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onPaste)
  stopGeneration()
})

function handleChangeModel(m: typeof AVAILABLE_MODELS[number]) { currentModel.value = m }
function handleNewChat() { createConversation(); showSidebar.value = false }
function handleImageToChat(dataUrl: string) {
  if (!requireChatAccess('/chat')) return
  pendingImages.value = [...pendingImages.value, dataUrl]
  void router.push('/chat')
}
function handleImageWorkspaceChange(mode: ImageWorkspace) {
  void router.push(mode === 'gallery' ? '/works' : '/image')
}

function handleImageModeChange(mode: 'imagio' | 'canvas') {
  imageMode.value = mode
}
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
        :show-image-panel="showImagePanel"
        :agent-mode="currentAgentMode"
        :messages="messages"
        :auth-email="userEmail"
        :auth-ready="isAuthReady"
        :auth-loading="isAuthLoading"
        @toggle-sidebar="toggleSidebar"
        @toggle-agent-panel="toggleAgentPanel"
        @toggle-image-panel="toggleImagePanel"
        @new-chat="handleNewChat"
        @toggle-settings="toggleSystemEditor"
        @open-auth="openAuthDialog()"
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

      <template v-if="showImagePanel">
        <ImageCanvas
          :workspace-mode="imageWorkspace"
          :image-mode="imageMode"
          :can-select-generation-count="true"
          @send-to-chat="handleImageToChat"
          @workspace-change="handleImageWorkspaceChange"
          @image-mode-change="handleImageModeChange"
        />
      </template>
      <template v-else>
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
      </template>
    </div>

    <AgentWorkspace
      v-if="showAgentPanel && !showImagePanel"
      :modes="AGENT_MODES"
      :active-mode="currentAgentMode"
      :skills="skills"
      :active-skill="activeSkill"
      :active-tool-calls="activeToolCalls"
      :completed-tool-calls="completedToolCalls"
      @change-mode="currentAgentMode = $event"
      @select-skill="selectSkill"
    />

    <AnnouncementPopup
      v-if="shouldShowAnnouncement && announcement"
      :announcement="announcement"
      @close="markAnnouncementRead()"
    />

    <div v-if="showAuthDialog" class="auth-overlay" @click.self="closeAuthDialog">
      <section class="auth-dialog" role="dialog" aria-modal="true" aria-label="账号">
        <header class="auth-dialog-header">
          <div>
            <span class="auth-eyebrow">账号</span>
            <h2>{{ user ? '账号信息' : (authMode === 'signIn' ? '登录 Recho' : '创建账号') }}</h2>
          </div>
          <button type="button" class="auth-close" title="关闭" @click="closeAuthDialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div v-if="user" class="auth-profile">
          <span>已登录</span>
          <strong>{{ userEmail }}</strong>
          <div class="auth-credit-card">
            <div class="auth-credit-header">
              <span>额度</span>
              <strong>{{ creditBalanceLabel }}</strong>
            </div>
            <form class="auth-credit-form" @submit.prevent="handleRedeemCredits">
              <input
                v-model="redeemCodeDraft"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="兑换码"
                :disabled="isRedeemingCredits"
              >
              <button type="submit" :disabled="isRedeemingCredits || !redeemCodeDraft.trim()">
                {{ isRedeemingCredits ? '兑换中' : '兑换' }}
              </button>
            </form>
            <p v-if="creditNotice" class="auth-credit-message success">{{ creditNotice }}</p>
            <p v-if="creditError" class="auth-credit-message error">{{ creditError }}</p>
          </div>
          <button type="button" :disabled="isAuthLoading" @click="handleSignOut">退出登录</button>
        </div>

        <form v-else class="auth-form" @submit.prevent="handleAuthSubmit">
          <label>
            <span>邮箱</span>
            <input v-model.trim="authEmailDraft" type="email" autocomplete="email" placeholder="you@example.com">
          </label>
          <label>
            <span>密码</span>
            <input v-model="authPasswordDraft" type="password" autocomplete="current-password" placeholder="至少 6 位密码">
          </label>

          <p v-if="authError" class="auth-message error">{{ authError }}</p>
          <p v-else-if="authNotice" class="auth-message">{{ authNotice }}</p>

          <button class="auth-submit" type="submit" :disabled="isAuthLoading">
            {{ isAuthLoading ? '处理中...' : (authMode === 'signIn' ? '登录' : '创建账号') }}
          </button>

          <button
            class="auth-oauth"
            type="button"
            :disabled="isAuthLoading"
            @click="handleGitHubAuth"
          >
            使用 GitHub 登录
          </button>

          <button
            class="auth-switch"
            type="button"
            @click="authMode = authMode === 'signIn' ? 'signUp' : 'signIn'"
          >
            {{ authMode === 'signIn' ? '没有账号，创建一个' : '已有账号，去登录' }}
          </button>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  background: var(--bg);
  position: relative;
  color: var(--text-primary);
}

.sidebar-backdrop { display: none; }

.chat-layout {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.system-editor-panel {
  width: min(920px, calc(100% - 48px));
  margin: 12px auto 0;
  padding: 14px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.system-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.system-editor-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.system-editor-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.system-editor-close:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
  border-color: var(--border);
}

.system-editor-textarea {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  font-size: 13px;
  font-family: var(--font-mono);
  line-height: 1.55;
  color: var(--text-primary);
  resize: vertical;
  outline: none;
  min-height: 96px;
}

.system-editor-textarea:focus {
  border-color: var(--accent);
  background: #fff;
}

.system-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.system-editor-btn {
  min-height: 30px;
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
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
  background:
    linear-gradient(180deg, rgba(248, 250, 252, 0.86), rgba(255, 255, 255, 0) 180px),
    var(--surface);
}

.messages-container {
  max-width: 920px;
  margin: 0 auto;
  padding: 28px 28px 36px;
}

.message-wrapper {
  margin-bottom: 22px;
}

.drag-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.16);
  backdrop-filter: blur(5px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--accent);
  border-radius: 8px;
  margin: 24px;
  pointer-events: none;
}

.drag-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--accent-strong);
  font-size: 16px;
  font-weight: 700;
  background: #fff;
  padding: 32px 48px;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
}

.auth-overlay {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(8px);
}

.auth-dialog {
  width: min(420px, calc(100vw - 48px));
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-md);
}

.auth-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}

.auth-eyebrow {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.auth-dialog h2 {
  margin: 3px 0 0;
  color: var(--text-primary);
  font-size: 20px;
  letter-spacing: 0;
}

.auth-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
}

.auth-close:hover {
  border-color: var(--border-strong);
  background: var(--hover-bg);
  color: var(--text-primary);
}

.auth-form {
  display: grid;
  gap: 12px;
}

.auth-form label {
  display: grid;
  gap: 6px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
}

.auth-form input {
  width: 100%;
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.auth-form input:focus {
  border-color: var(--accent);
  background: #fff;
}

.auth-message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.auth-message.error {
  color: var(--danger);
}

.auth-submit,
.auth-oauth,
.auth-switch,
.auth-profile button,
.auth-credit-form button {
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.auth-submit {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.auth-oauth {
  background: #fff;
  color: var(--text-primary);
}

.auth-oauth:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

.auth-submit:disabled,
.auth-oauth:disabled,
.auth-profile button:disabled,
.auth-credit-form button:disabled {
  opacity: 0.58;
  cursor: default;
}

.auth-switch {
  background: #fff;
  color: var(--text-primary);
}

.auth-switch:hover,
.auth-profile button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

.auth-profile {
  display: grid;
  gap: 10px;
}

.auth-profile span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.auth-profile strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-profile button {
  background: #fff;
  color: var(--text-primary);
}

.auth-credit-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

.auth-credit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.auth-credit-header span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 900;
}

.auth-credit-header strong {
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  line-height: 1;
}

.auth-credit-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.auth-credit-form input {
  width: 100%;
  min-width: 0;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.auth-credit-form input:focus {
  border-color: var(--accent);
}

.auth-credit-form button {
  padding: 0 14px;
  background: #111827;
  color: #fff;
}

.auth-credit-message {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.4;
}

.auth-credit-message.success {
  color: #047857;
}

.auth-credit-message.error {
  color: var(--danger);
}

@media (max-width: 768px) {
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.38);
    z-index: 50;
  }

  .messages-container {
    padding: 18px 14px 28px;
  }

  .system-editor-panel {
    width: calc(100% - 24px);
  }

  .auth-overlay {
    align-items: end;
    padding: 12px;
  }

  .auth-dialog {
    width: 100%;
    padding: 16px;
  }

  .auth-close {
    width: 44px;
    height: 44px;
  }

  .auth-form input,
  .auth-submit,
  .auth-oauth,
  .auth-switch,
  .auth-profile button,
  .auth-credit-form input,
  .auth-credit-form button,
  .system-editor-btn {
    min-height: 44px;
    font-size: 14px;
  }
}
</style>
