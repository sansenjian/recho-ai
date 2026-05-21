<script setup lang="ts">
import type { Message } from '../types'

defineProps<{
  msg: Message
  rendered?: string
  copyFeedback?: boolean
}>()

defineEmits<{
  copy: []
  retry: []
}>()
</script>

<template>
  <div v-if="msg.role === 'assistant'" class="msg-row assistant">
    <div class="assistant-avatar">AI</div>
    <div class="msg-body">
      <div v-if="rendered" class="msg-text md" v-html="rendered" />
      <div v-else class="msg-text">{{ msg.content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '') }}</div>
      <div class="msg-time-row">
        <span class="msg-time" :title="msg.timestamp">{{ msg.timestamp }}</span>
      </div>
    </div>
  </div>

  <div v-else class="msg-row user">
    <div class="user-wrapper">
      <div class="msg-text">{{ msg.content }}</div>
      <div class="msg-actions">
        <button class="action-btn" :class="{ done: copyFeedback }" title="复制" @click="$emit('copy')">
          <svg v-if="!copyFeedback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <button class="action-btn" title="重试" @click="$emit('retry')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <path d="M3 12a9 9 0 1 1 3 6.73" />
            <polyline points="3 22 3 15 10 15" />
          </svg>
        </button>
        <span class="msg-time" :title="msg.timestamp">{{ msg.timestamp }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.msg-row.assistant { justify-content: flex-start; }
.msg-row.user { justify-content: flex-end; }

.assistant-avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #eaf2ff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: #2a7fff;
  margin-top: 2px;
}

.msg-body {
  flex: 1;
  min-width: 0;
}

.user-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.msg-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.msg-time-row {
  margin-top: 4px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #b0b0be;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.action-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.action-btn.done {
  color: #22c55e;
}

.msg-time {
  font-size: 11px;
  color: #b0b0be;
  margin-left: 4px;
  white-space: nowrap;
}

.msg-text {
  font-size: 15px;
  line-height: 1.65;
  color: #1a1a2e;
  word-break: break-word;
}

.assistant .msg-text { font-weight: 600; }

.user .msg-text {
  color: #5a5a6e;
  background: var(--bubble-bg);
  padding: 8px 12px;
  border-radius: 12px;
}
</style>
