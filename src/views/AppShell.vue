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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Image, X } from '@lucide/vue'

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

function assistantMessageIndex(id: string) {
  const assistantMessages = messages.value.filter(msg => msg.role === 'assistant')
  const index = assistantMessages.findIndex(msg => msg.id === id)
  return index >= 0 ? index + 1 : 1
}

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
const imageMode = ref<'imagio' | 'canvas'>('imagio')
function toggleSidebar() { showSidebar.value = !showSidebar.value }
function closeSidebar() { showSidebar.value = false }

function currentRouteWorkspace(): RouteWorkspace {
  const workspace = route.meta.workspace
  return workspace === 'chat' || workspace === 'image' ? workspace : 'image'
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
  imageWorkspace.value = 'canvas'
  if (workspace === 'image') {
    imageMode.value = 'imagio'
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
  const ok = await submitAuth(authMode.value, authEmailDraft.value.trim(), authPasswordDraft.value)
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
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(img.src)
        return reject(new Error('canvas 2d context unavailable'))
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
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
  if (!hasFileTransfer(e)) return false
  if (currentRouteWorkspace() !== 'image') return false
  e.preventDefault()
  dragCounter = 0
  isDragOver.value = false
  return true
}

function onDragEnter(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  e.preventDefault()
  if (showImagePanel.value) return
  dragCounter++
  if (dragCounter === 1) isDragOver.value = true
}
function onDragLeave(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  e.preventDefault()
  if (showImagePanel.value) return
  dragCounter--
  if (dragCounter === 0) isDragOver.value = false
}
function onDragOver(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  e.preventDefault()
  if (showImagePanel.value) return
}
function onDrop(e: DragEvent) {
  if (suppressWorksFileDrag(e)) return
  e.preventDefault()
  if (showImagePanel.value) return
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
const copyFeedbackId = ref<string | null>(null)
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
  imageWorkspace.value = mode
  if (currentRouteWorkspace() !== 'image') {
    void router.push('/image')
  }
}

function handleImageModeChange(mode: 'imagio' | 'canvas') {
  imageMode.value = mode
}
</script>

<template>
  <div
    class="flex h-screen relative bg-background text-foreground text-sm font-sans antialiased"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <!-- Drag Overlay -->
    <div
      v-if="isDragOver"
      class="fixed inset-0 bg-black/12 backdrop-blur-sm z-[200] flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-6 pointer-events-none"
    >
      <div class="flex flex-col items-center gap-3 text-primary text-[15px] font-semibold tracking-tight bg-card p-7 px-10 rounded-lg shadow-lg">
        <Image :size="40" stroke-width="1.5" />
        <span>拖放图片到此处</span>
      </div>
    </div>

    <!-- Sidebar Backdrop -->
    <div v-if="showSidebar" class="md:hidden fixed inset-0 bg-black/32 z-50" @click="closeSidebar" />
    <ChatSidebar v-if="showSidebar" @close="closeSidebar" />

    <!-- Chat Layout -->
    <div class="flex flex-col flex-1 min-w-0 bg-background">
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
        @open-image="router.push('/image')"
        @new-chat="handleNewChat"
        @toggle-settings="toggleSystemEditor"
        @open-auth="openAuthDialog()"
      />

      <!-- System Editor Panel -->
      <div
        v-if="showSystemEditor"
        class="w-[min(780px,calc(100%-48px))] mx-auto mt-3 p-4 bg-card rounded-lg shadow-sm max-md:w-[calc(100%-24px)]"
      >
        <div class="flex items-center justify-between mb-2.5">
          <span class="text-[11px] font-semibold text-foreground uppercase tracking-wider">系统提示词</span>
          <Button variant="ghost" size="icon-xs" class="text-muted-foreground hover:text-foreground" @click="closeSystemEditor">
            <X :size="14" />
          </Button>
        </div>
        <Textarea
          v-model="systemPromptDraft"
          placeholder="输入系统提示词..."
          :rows="4"
          class="min-h-24 text-[13px] font-mono leading-relaxed resize-y"
          @keydown.escape="closeSystemEditor"
        />
        <div class="flex justify-end gap-2 mt-2.5">
          <Button variant="outline" size="sm" @click="showSystemEditor = false">取消</Button>
          <Button size="sm" @click="saveSystemPrompt">保存</Button>
        </div>
      </div>

      <!-- Image Panel -->
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

      <!-- Chat Panel -->
      <template v-else>
        <main ref="chatAreaRef" class="flex-1 overflow-y-auto bg-secondary">
          <div class="max-w-[880px] mx-auto px-6 pt-7 pb-9 max-md:px-3 max-md:pt-4 max-md:pb-6">
            <div v-for="msg in messages" :key="msg.id" class="mb-4">
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
                :msg="msg"
                :copy-feedback="copyFeedbackId === msg.id"
                :assistant-index="assistantMessageIndex(msg.id)"
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

    <!-- Agent Workspace -->
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

    <!-- Announcement -->
    <AnnouncementPopup
      v-if="shouldShowAnnouncement && announcement"
      :announcement="announcement"
      @close="markAnnouncementRead()"
    />

    <!-- Auth Dialog -->
    <div
      v-if="showAuthDialog"
      class="fixed inset-0 z-[220] grid place-items-center p-6 bg-black/32 backdrop-blur-lg max-md:items-end max-md:p-3"
      @click.self="closeAuthDialog"
    >
      <section class="w-full max-w-[420px] p-5 rounded-lg bg-card shadow-lg max-md:max-w-none max-md:p-4" role="dialog" aria-modal="true" aria-label="账号">
        <header class="flex items-start justify-between gap-3.5 mb-4">
          <div>
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">账号</span>
            <h2 class="mt-1 text-[17px] font-bold text-foreground tracking-tight">{{ user ? '账号信息' : (authMode === 'signIn' ? '登录 Recho' : '创建账号') }}</h2>
          </div>
          <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-foreground shadow-sm" title="关闭" @click="closeAuthDialog">
            <X :size="16" />
          </Button>
        </header>

        <!-- Auth Profile -->
        <div v-if="user" class="grid gap-2.5">
          <span class="text-xs font-semibold text-muted-foreground">已登录</span>
          <strong class="overflow-hidden text-sm font-semibold text-foreground text-ellipsis whitespace-nowrap">{{ userEmail }}</strong>
          <div class="grid gap-2.5 p-3.5 rounded-lg bg-muted">
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs font-semibold text-muted-foreground">额度</span>
              <strong class="text-xl font-semibold text-foreground tracking-tight leading-none">{{ creditBalanceLabel }}</strong>
            </div>
            <form class="grid grid-cols-[1fr_auto] gap-2" @submit.prevent="handleRedeemCredits">
              <Input
                v-model="redeemCodeDraft"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="兑换码"
                :disabled="isRedeemingCredits"
                class="h-9"
              />
              <Button type="submit" :disabled="isRedeemingCredits || !redeemCodeDraft.trim()" class="h-9 px-3.5">
                {{ isRedeemingCredits ? '兑换中' : '兑换' }}
              </Button>
            </form>
            <p v-if="creditNotice" class="text-xs font-semibold leading-snug text-foreground">{{ creditNotice }}</p>
            <p v-if="creditError" class="text-xs font-semibold leading-snug text-destructive">{{ creditError }}</p>
          </div>
          <Button variant="outline" :disabled="isAuthLoading" @click="handleSignOut">退出登录</Button>
        </div>

        <!-- Auth Form -->
        <form v-else class="grid gap-3" @submit.prevent="handleAuthSubmit">
          <label class="grid gap-1.5 text-xs font-semibold text-foreground">
            <span>邮箱</span>
            <Input v-model="authEmailDraft" type="email" autocomplete="email" placeholder="you@example.com" />
          </label>
          <label class="grid gap-1.5 text-xs font-semibold text-foreground">
            <span>密码</span>
            <Input v-model="authPasswordDraft" type="password" autocomplete="current-password" placeholder="至少 6 位密码" />
          </label>

          <p v-if="authError" class="text-xs leading-snug text-destructive">{{ authError }}</p>
          <p v-else-if="authNotice" class="text-xs leading-snug text-muted-foreground">{{ authNotice }}</p>

          <Button type="submit" :disabled="isAuthLoading" class="w-full">
            {{ isAuthLoading ? '处理中...' : (authMode === 'signIn' ? '登录' : '创建账号') }}
          </Button>

          <Button variant="outline" type="button" :disabled="isAuthLoading" class="w-full" @click="handleGitHubAuth">
            使用 GitHub 登录
          </Button>

          <Button variant="ghost" type="button" class="w-full" @click="authMode = authMode === 'signIn' ? 'signUp' : 'signIn'">
            {{ authMode === 'signIn' ? '没有账号，创建一个' : '已有账号，去登录' }}
          </Button>
        </form>
      </section>
    </div>
  </div>
</template>
