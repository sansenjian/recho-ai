<script setup lang="ts">
import { computed } from 'vue'
import type { Message, MessageBlock } from '../types'
import { getRendered, getRenderedText } from '../utils/markdown'
import { stripThinking } from '../utils/messageText'
import ToolActivity from './ToolActivity.vue'
import ThinkingActivity from './ThinkingActivity.vue'

const props = defineProps<{
  msg: Message
  copyFeedback?: boolean
}>()

defineEmits<{
  copy: []
  retry: []
}>()

const blocks = computed(() => props.msg.blocks ?? [])
const hasBlocks = computed(() => props.msg.role === 'assistant' && blocks.value.length > 0)
const hasThinkingBlock = computed(() => blocks.value.some(block => block.type === 'thinking'))
const hasToolBlock = computed(() => blocks.value.some(block => block.type === 'tool_use'))
const shouldShowThinkingPlaceholder = computed(() =>
  props.msg.role === 'assistant' &&
  hasToolBlock.value &&
  !hasThinkingBlock.value,
)
const renderedMessage = computed(() => getRendered(props.msg))

function textRendered(block: Extract<MessageBlock, { type: 'assistant_text' }>) {
  return getRenderedText(block.content)
}

function toolBlockToCall(block: Extract<MessageBlock, { type: 'tool_use' }>) {
  return {
    id: block.toolUseId,
    name: block.name,
    arguments: block.input,
    result: block.result,
    isError: block.isError,
    status: block.status,
    startedAt: block.startedAt,
    completedAt: block.completedAt,
  }
}
</script>

<template>
  <div v-if="msg.role === 'assistant'" class="msg-row assistant">
    <div class="assistant-avatar">AI</div>
    <div class="msg-body">
      <ThinkingActivity
        v-if="shouldShowThinkingPlaceholder"
        embedded
        placeholder
        status="done"
      />
      <template v-if="hasBlocks">
        <template v-for="block in blocks" :key="block.id">
          <ThinkingActivity
            v-if="block.type === 'thinking'"
            embedded
            :content="block.content"
            :status="block.status"
            :active="block.status === 'running'"
          />
          <ToolActivity
            v-else-if="block.type === 'tool_use'"
            embedded
            :active-tool-calls="block.status === 'running' ? [toolBlockToCall(block)] : []"
            :completed-tool-calls="block.status !== 'running' ? [toolBlockToCall(block)] : []"
          />
          <div
            v-else-if="block.type === 'assistant_text' && block.content"
            class="msg-text md block-text"
            :class="{ incomplete: block.status === 'incomplete' }"
            v-html="textRendered(block)"
          />
        </template>
      </template>
      <template v-else>
        <div v-if="renderedMessage" class="msg-text md" v-html="renderedMessage" />
        <div v-else class="msg-text">{{ stripThinking(msg.content) }}</div>
      </template>
      <div class="msg-time-row">
        <span class="msg-time" :title="msg.timestamp">{{ msg.timestamp }}</span>
      </div>
    </div>
  </div>

  <div v-else class="msg-row user">
    <div class="user-wrapper">
      <div v-if="msg.images?.length" class="msg-images">
        <img v-for="(img, i) in msg.images" :key="i" :src="img" class="msg-image" />
      </div>
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
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-family: var(--font-mono);
  font-weight: 700;
  color: #bbf7d0;
  margin-top: 2px;
  box-shadow: var(--shadow-sm);
}

.msg-body {
  flex: 1;
  min-width: 0;
  max-width: 780px;
}

.assistant :deep(.thinking-activity),
.assistant :deep(.tool-activity) {
  margin-top: 8px;
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
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.action-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.action-btn.done {
  color: var(--accent);
}

.msg-time {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 4px;
  white-space: nowrap;
}

.msg-text {
  font-size: 15px;
  line-height: 1.68;
  color: var(--text-primary);
  word-break: break-word;
}

.assistant .msg-text {
  font-weight: 500;
}

.assistant .block-text {
  margin-top: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-sm);
}

.assistant .block-text.incomplete {
  border-color: rgba(217, 119, 6, 0.28);
  background: #fffbeb;
  color: #92400e;
}

.user .msg-text {
  color: var(--text-primary);
  background: var(--bubble-bg);
  padding: 9px 13px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.msg-images {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.msg-image {
  max-width: 240px;
  max-height: 240px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: opacity 0.15s;
}

.msg-image:hover {
  opacity: 0.85;
}
</style>
