<script setup lang="ts">
import { computed } from 'vue'
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
  agentMode: AgentModeOption
  messages: Message[]
  authEmail: string
  authReady: boolean
  authLoading: boolean
  canUseChat: boolean
  isCheckingChatAccess: boolean
}>()

const authLabel = computed(() => {
  if (!props.authEmail) return '登录'
  return props.authEmail.split('@')[0] || props.authEmail
})

const chatButtonTitle = computed(() => {
  if (!props.showImagePanel) return '对话'
  if (!props.authEmail) return '登录管理员账号后进入 Chat'
  if (props.isCheckingChatAccess) return '正在检查 Chat 权限'
  if (!props.canUseChat) return '仅管理员可进入 Chat'
  return '对话'
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
    class="sticky top-0 z-30 flex h-14 w-full max-w-[100vw] shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border bg-background/95 px-2 backdrop-blur-xl sm:gap-4 sm:px-4 lg:px-6"
  >
    <div class="flex min-w-0 flex-auto items-center gap-2 sm:gap-3">
      <Button
        v-if="!showImagePanel"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        title="历史"
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
        class="flex shrink-0 items-center gap-1 rounded-[var(--radius-lg,8px)] border border-border bg-muted/70 p-1 shadow-sm"
        aria-label="工作区切换"
      >
        <Button
          variant="ghost"
          size="sm"
          class="h-7 min-w-[68px] gap-1.5 rounded-[var(--radius-md,7px)] px-3 text-[13px] leading-none"
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
          <span>{{ showImagePanel && authEmail && isCheckingChatAccess ? '检查中' : '对话' }}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 min-w-[68px] gap-1.5 rounded-[var(--radius-md,7px)] px-3 text-[13px] leading-none"
          :class="cn(
            showImagePanel
              ? 'bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          )"
          :aria-pressed="showImagePanel"
          @click="$emit('openImage')"
        >
          <Image class="h-3.5 w-3.5" />
          <span>画布</span>
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
        title="新对话"
        @click="$emit('newChat')"
      >
        <Plus class="h-3.5 w-3.5" />
        <span class="max-[900px]:hidden">新对话</span>
      </Button>

      <Button
        v-if="!showImagePanel"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        title="代理面板"
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
        title="系统提示词"
        @click="$emit('toggleSettings')"
      >
        <Settings class="h-4 w-4" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-[132px] shrink-0 justify-start gap-[7px] overflow-hidden px-2.5 lg:w-[132px] md:w-[112px] sm:w-[104px] max-[420px]:w-24 max-[640px]:w-[104px]"
        :disabled="authLoading"
        :title="authEmail || '登录'"
        @click="$emit('openAuth')"
      >
        <span
          class="h-[7px] w-[7px] shrink-0 rounded-full"
          :class="{
            'bg-muted-foreground': !authEmail && authReady && !authLoading,
            'bg-foreground': !!authEmail,
            'bg-amber-500': (!authReady || authLoading),
          }"
        />
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ authLabel }}</span>
      </Button>
    </div>
  </header>
</template>
