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
}>()

const authLabel = computed(() => {
  if (!props.authEmail) return '登录'
  return props.authEmail.split('@')[0] || props.authEmail
})

defineEmits<{
  toggleSidebar: []
  toggleAgentPanel: []
  toggleImagePanel: []
  openImage: []
  newChat: []
  toggleSettings: []
  openAuth: []
}>()
</script>

<template>
  <header
    class="app-topbar sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-2 backdrop-blur-xl sm:gap-4 sm:px-4 lg:px-6"
  >
    <div class="topbar-primary flex min-w-0 items-center gap-2 sm:gap-3">
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

      <div class="brand-lockup flex shrink-0 items-center gap-2 text-foreground">
        <Zap class="h-5 w-5" />
        <span class="hidden text-sm font-semibold tracking-[-0.24px] sm:inline">Recho</span>
      </div>

      <div
        class="workspace-switcher"
        aria-label="工作区切换"
      >
        <Button
          variant="ghost"
          size="sm"
          class="workspace-switcher-button"
          :class="cn(
            !showImagePanel
              ? 'bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          )"
          :aria-pressed="!showImagePanel"
          @click="!showImagePanel ? undefined : $emit('toggleImagePanel')"
        >
          <MessageSquare class="h-3.5 w-3.5" />
          <span>对话</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="workspace-switcher-button"
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
        class="new-chat-button h-8 shrink-0 gap-1.5 px-2.5 text-xs font-medium"
        title="新对话"
        @click="$emit('newChat')"
      >
        <Plus class="h-3.5 w-3.5" />
        <span class="new-chat-label">新对话</span>
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
        class="auth-chip"
        :disabled="authLoading"
        :title="authEmail || '登录'"
        @click="$emit('openAuth')"
      >
        <span
          class="auth-chip-dot"
          :class="{
            'bg-muted-foreground': !authEmail && authReady && !authLoading,
            'bg-foreground': !!authEmail,
            'bg-amber-500': (!authReady || authLoading),
          }"
        />
        <span class="auth-chip-label">{{ authLabel }}</span>
      </Button>
    </div>
  </header>
</template>

<style scoped>
.app-topbar {
  width: 100%;
  max-width: 100vw;
  overflow: hidden;
  padding-inline: 16px;
}

.topbar-primary {
  flex: 1 1 auto;
}

.workspace-switcher {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--muted) / 0.7);
  box-shadow: var(--shadow-sm);
}

.workspace-switcher-button {
  min-width: 68px;
  height: 28px;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--radius-md, 7px);
  font-size: 13px;
  line-height: 1;
}

.auth-chip {
  width: 132px;
  max-width: 132px;
  min-width: 0;
  flex: 0 1 132px;
  justify-content: flex-start;
  gap: 7px;
  overflow: hidden;
  padding: 0 10px;
}

.auth-chip-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
}

.auth-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1024px) {
  .auth-chip {
    width: 112px;
    max-width: 112px;
    flex-basis: 112px;
    gap: 7px;
    padding: 0 9px;
  }
}

@media (max-width: 900px) {
  .new-chat-button {
    width: 32px;
    padding: 0;
  }

  .new-chat-label {
    display: none;
  }
}

@media (max-width: 640px) {
  .app-topbar {
    gap: 8px;
    padding-inline: 10px;
  }

  .workspace-switcher {
    padding: 4px;
  }

  .workspace-switcher-button {
    min-width: 64px;
    padding: 0 9px;
    font-size: 12px;
  }

  .auth-chip {
    width: 104px;
    max-width: 104px;
    flex-basis: 104px;
    justify-content: flex-start;
    padding: 0 9px;
  }
}

@media (max-width: 480px) {
  .brand-lockup {
    display: none;
  }
}

@media (max-width: 420px) {
  .app-topbar {
    padding-inline: 8px;
  }

  .topbar-primary {
    gap: 6px;
  }

  .workspace-switcher {
    gap: 3px;
    padding: 3px;
  }

  .workspace-switcher-button {
    min-width: 54px;
    gap: 4px;
    padding: 0 6px;
  }

  .auth-chip {
    width: 96px;
    max-width: 96px;
    flex-basis: 96px;
    padding: 0 8px;
  }
}

@media (max-width: 380px) {
  .new-chat-button {
    display: none;
  }

  .auth-chip {
    width: 92px;
    max-width: 92px;
    flex-basis: 92px;
  }
}
</style>
