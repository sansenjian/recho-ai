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
import AuthPanel from '../components/AuthPanel.vue'
import { useAuthSession } from '../composables/useAuthSession'
import { useAdminAccess } from '../composables/useAdminAccess'
import { useAnnouncementPopup } from '../composables/useAnnouncementPopup'
import { apiUrl } from '../lib/api-base'
import { hasFileTransfer } from '../lib/image-canvas-utils'
import type { RouteWorkspace } from '../router'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Image as ImageIcon, X } from '@lucide/vue'

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
  isAuthReady,
  isAuthLoading,
  initAuth,
} = useAuthSession()
const {
  isAdminReady,
  isAdmin,
  isCheckingAdmin,
  ensureAdminAccess,
  resetAdminAccess,
} = useAdminAccess()
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

async function requireChatAccess(nextPath = '/chat') {
  if (isAdmin.value) return true
  pendingAuthPath.value = nextPath
  if (!user.value) {
    openAuthDialog('signIn')
  } else {
    const allowed = isAdminReady.value ? isAdmin.value : await ensureAdminAccess()
    if (allowed) return true
    window.alert('只有管理员可以进入 Chat。')
  }
  return false
}

async function syncWorkspaceFromRoute() {
  const workspace = currentRouteWorkspace()
  if (workspace === 'chat' && user.value && !isAdmin.value && isAuthReady.value) {
    const allowed = isAdminReady.value ? isAdmin.value : await ensureAdminAccess()
    if (allowed) {
      showImagePanel.value = false
      showAgentPanel.value = false
      imageWorkspace.value = 'canvas'
      return
    }
  }

  if (workspace === 'chat' && (!user.value || !isAdmin.value)) {
    showImagePanel.value = true
    showAgentPanel.value = false
    imageWorkspace.value = 'canvas'
    imageMode.value = 'imagio'
    if (isAuthReady.value) {
      pendingAuthPath.value = '/chat'
      if (!user.value) openAuthDialog('signIn')
      else window.alert('只有管理员可以进入 Chat。')
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
    if (!await requireChatAccess('/chat')) return
    await router.push('/chat')
  }
  showAgentPanel.value = !showAgentPanel.value
}
async function toggleImagePanel() {
  if (currentRouteWorkspace() === 'chat') {
    void router.push('/image')
    return
  }
  if (!await requireChatAccess('/chat')) return
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
const pendingAuthPath = ref<string | null>(null)

function openAuthDialog(mode: AuthMode = 'signIn') {
  authMode.value = mode
  showAuthDialog.value = true
}

function closeAuthDialog() {
  pendingAuthPath.value = null
  showAuthDialog.value = false
}

watch(() => user.value?.id || null, (nextUserId, previousUserId) => {
  resetAdminAccess()
  if (nextUserId) {
    void ensureAdminAccess()
  }
  if (nextUserId && !previousUserId && showAuthDialog.value) {
    const nextPath = pendingAuthPath.value
    pendingAuthPath.value = null
    showAuthDialog.value = false
    if (nextPath) {
      void router.push(nextPath)
    }
  }
})

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
  if (!await requireChatAccess('/chat')) return
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
  void syncWorkspaceFromRoute()
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
  void (async () => {
    if (!await requireChatAccess('/chat')) return
    pendingImages.value = [...pendingImages.value, dataUrl]
    void router.push('/chat')
  })()
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
        <ImageIcon :size="40" stroke-width="1.5" />
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
        :can-use-chat="isAdmin"
        :is-checking-chat-access="isCheckingAdmin"
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

    <AuthPanel
      v-if="showAuthDialog"
      v-model="showAuthDialog"
      :initial-mode="authMode"
      :redirect-path="pendingAuthPath || route.fullPath || '/image'"
      @close="closeAuthDialog"
    />
  </div>
</template>
