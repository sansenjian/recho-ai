<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentModeOption, Message } from '../types'
import ContextMeter from './ContextMeter.vue'
import { Button } from '@/components/ui/button'
import {
  Menu,
  X,
  Plus,
  PanelLeft,
  Image,
  MessageSquare,
  Settings,
  Zap,
} from '@lucide/vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  showSidebar: boolean
  showAgentPanel: boolean
  showImagePanel: boolean
  imageWorkspace: 'canvas' | 'gallery'
  agentMode: AgentModeOption
  messages: Message[]
  authEmail: string
  authReady: boolean
  authLoading: boolean
  canUseChat: boolean
  isCheckingChatAccess: boolean
}>()

const { t } = useI18n()

const authLabel = computed(() => {
  if (!props.authEmail) return t('chat.login')
  return props.authEmail.split('@')[0] || props.authEmail
})

const chatButtonTitle = computed(() => {
  if (!props.showImagePanel) return t('chat.chat')
  if (!props.authEmail) return t('chat.loginRequiredForChat')
  if (props.isCheckingChatAccess) return t('chat.checkingChatAccess')
  if (!props.canUseChat) return t('chat.adminOnlyChat')
  return t('chat.chat')
})

const chatButtonDisabled = computed(() => (
  props.showImagePanel &&
  Boolean(props.authEmail) &&
  (props.isCheckingChatAccess || !props.canUseChat)
))

const emit = defineEmits<{
  toggleSidebar: []
  toggleAgentPanel: []
  toggleImagePanel: []
  openImage: []
  openGallery: []
  newChat: []
  toggleSettings: []
  openAuth: []
}>()

function handleChatButtonClick() {
  if (!props.showImagePanel) return
  if (!props.authEmail) {
    emit('openAuth')
    return
  }
  if (chatButtonDisabled.value) return
  emit('toggleImagePanel')
}

</script>

<template>
  <header
    class="sticky top-0 z-30 flex h-14 w-full max-w-[100vw] shrink-0 items-center justify-between gap-2 overflow-x-auto overflow-y-hidden border-b border-border bg-background/95 px-2 backdrop-blur-xl sm:gap-4 sm:px-4 lg:px-6"
  >
    <div class="flex min-w-0 flex-auto items-center gap-2 sm:gap-3">
      <Button
        v-if="!showImagePanel"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        :title="t('chat.history')"
        @click="$emit('toggleSidebar')"
      >
        <X v-if="showSidebar" class="h-4 w-4" />
        <Menu v-else class="h-4 w-4" />
      </Button>

      <div class="flex shrink-0 items-center gap-2 text-foreground max-[480px]:hidden">
        <Zap class="h-5 w-5" />
        <span class="hidden text-sm font-semibold tracking-[-0.24px] sm:inline">Recho</span>
      </div>

      <div
        class="flex shrink-0 items-center gap-1 rounded-[var(--radius-lg,8px)] border border-border bg-muted/70 p-1 shadow-sm max-[420px]:gap-0"
        :aria-label="t('chat.workspaceSwitch')"
      >
        <Button
          variant="ghost"
          size="sm"
          class="h-7 min-w-[68px] gap-1.5 rounded-[var(--radius-md,7px)] px-3 text-[13px] leading-none max-[420px]:min-w-0 max-[420px]:gap-1 max-[420px]:px-1 max-[420px]:text-[11px]"
          :class="cn(
            !showImagePanel
              ? 'bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          )"
          :aria-pressed="!showImagePanel"
          :disabled="chatButtonDisabled"
          :title="chatButtonTitle"
          @click="handleChatButtonClick"
        >
          <MessageSquare class="h-3.5 w-3.5" />
          <span>{{ showImagePanel && authEmail && isCheckingChatAccess ? t('chat.checking') : t('chat.chat') }}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 min-w-[68px] gap-1.5 rounded-[var(--radius-md,7px)] px-3 text-[13px] leading-none max-[420px]:min-w-0 max-[420px]:gap-1 max-[420px]:px-1 max-[420px]:text-[11px]"
          :class="cn(
            showImagePanel && imageWorkspace === 'canvas'
              ? 'bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          )"
          :aria-pressed="showImagePanel && imageWorkspace === 'canvas'"
          @click="$emit('openImage')"
        >
          <Image class="h-3.5 w-3.5" />
          <span>{{ t('chat.canvas') }}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 min-w-[68px] gap-1.5 rounded-[var(--radius-md,7px)] px-3 text-[13px] leading-none max-[420px]:min-w-0 max-[420px]:gap-1 max-[420px]:px-1 max-[420px]:text-[11px]"
          :class="cn(
            showImagePanel && imageWorkspace === 'gallery'
              ? 'bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          )"
          :aria-pressed="showImagePanel && imageWorkspace === 'gallery'"
          @click="$emit('openGallery')"
        >
          <Image class="h-3.5 w-3.5" />
          <span>{{ t('chat.gallery') }}</span>
        </Button>
      </div>

      <div v-if="!showImagePanel" class="hidden xl:block">
        <ContextMeter :messages="messages" />
      </div>
    </div>

    <div class="flex min-w-0 items-center gap-1.5">
      <Button
        v-if="!showImagePanel"
        variant="outline"
        size="sm"
        class="h-8 shrink-0 gap-1.5 px-2.5 text-xs font-medium max-[900px]:w-8 max-[900px]:px-0 max-[380px]:hidden"
        :title="t('chat.newChat')"
        @click="$emit('newChat')"
      >
        <Plus class="h-3.5 w-3.5" />
        <span class="max-[900px]:hidden">{{ t('chat.newChat') }}</span>
      </Button>

      <Button
        v-if="!showImagePanel"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        :title="t('chat.agentPanel')"
        :class="cn(showAgentPanel && 'bg-accent text-accent-foreground')"
        @click="$emit('toggleAgentPanel')"
      >
        <PanelLeft class="h-4 w-4" />
      </Button>

      <Button
        v-if="!showImagePanel"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        :title="t('chat.systemPrompt')"
        @click="$emit('toggleSettings')"
      >
        <Settings class="h-4 w-4" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-[132px] shrink-0 justify-start gap-[7px] overflow-hidden px-2.5 lg:w-[132px] md:w-[112px] sm:w-[104px] max-[420px]:w-20 max-[640px]:w-[104px]"
        :disabled="authLoading"
        :title="authEmail || t('chat.login')"
        @click="$emit('openAuth')"
      >
        <span
          class="h-[7px] w-[7px] shrink-0 rounded-full"
          :class="{
            'bg-muted-foreground': !authEmail && authReady && !authLoading,
            'bg-foreground': !!authEmail,
            'bg-warning': (!authReady || authLoading),
          }"
        />
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ authLabel }}</span>
      </Button>
    </div>
  </header>
</template>
