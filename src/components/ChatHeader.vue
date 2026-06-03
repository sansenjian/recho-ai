<script setup lang="ts">
import type { AgentModeOption, Message } from '../types'
import ContextMeter from './ContextMeter.vue'

defineProps<{
  showSidebar: boolean
  showAgentPanel: boolean
  showImagePanel: boolean
  agentMode: AgentModeOption
  messages: Message[]
}>()

defineEmits<{
  toggleSidebar: []
  toggleAgentPanel: []
  toggleImagePanel: []
  newChat: []
  toggleSettings: []
}>()
</script>

<template>
  <header class="chat-header">
    <div class="header-left">
      <button class="sidebar-toggle" title="History" @click="$emit('toggleSidebar')">
        <svg v-if="!showSidebar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="18" height="18">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="18" height="18">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <button class="project-selector" @click="$emit('newChat')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span class="project-name">New Chat</span>
      </button>
      <div class="agent-status">
        <span class="status-pill">{{ agentMode.label }}</span>
        <ContextMeter :messages="messages" />
      </div>
    </div>
    <div class="header-center">
      <span class="brand-mark">Recho</span>
      <span class="brand-divider" />
      <span class="brand-context">{{ agentMode.hint }}</span>
    </div>
    <div class="header-right">
      <button
        class="icon-btn"
        :class="{ active: showAgentPanel }"
        title="Agent Panel"
        @click="$emit('toggleAgentPanel')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
      <button
        class="icon-btn"
        :class="{ active: showImagePanel }"
        title="Image Canvas"
        @click="$emit('toggleImagePanel')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <rect x="2" y="2" width="20" height="20" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </button>
      <button class="icon-btn" title="System Prompt" @click="$emit('toggleSettings')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 58px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--header-bg);
  backdrop-filter: blur(14px);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.sidebar-toggle:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
  border-color: var(--border);
}

.project-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  box-shadow: var(--shadow-sm);
}

.project-selector:hover {
  background: var(--hover-bg);
  border-color: var(--border-strong);
}

.project-name {
  font-weight: 600;
}

.agent-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.header-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.brand-mark {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.brand-divider {
  width: 1px;
  height: 16px;
  background: var(--border);
}

.brand-context {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(22, 163, 74, 0.26);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.icon-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
  border-color: var(--border);
}

.icon-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(22, 163, 74, 0.24);
}

@media (max-width: 880px) {
  .header-center {
    display: none;
  }
}

@media (max-width: 560px) {
  .agent-status {
    display: none;
  }

  .project-name {
    display: none;
  }
}
</style>
