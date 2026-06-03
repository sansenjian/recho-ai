<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  content?: string
  active?: boolean
  status?: 'running' | 'done' | 'cancelled'
  embedded?: boolean
  placeholder?: boolean
}>()

const normalized = computed(() => (props.content || '').trim())
const isWaitingForThinking = computed(() => props.status === 'running' && !normalized.value)
const hasPlaceholder = computed(() => props.placeholder && !normalized.value)
const shouldAutoExpand = computed(() => props.active || props.status === 'running')
const expanded = ref(shouldAutoExpand.value)
const contentEl = ref<HTMLElement | null>(null)
const lines = computed(() => normalized.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
const preview = computed(() => {
  const first = lines.value[0] || ''
  return first.length > 96 ? `${first.slice(0, 96)}...` : first
})

function scrollThinkingToBottom() {
  const el = contentEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch([shouldAutoExpand, normalized, hasPlaceholder, isWaitingForThinking], async ([autoExpand]) => {
  if (autoExpand && (normalized.value || hasPlaceholder.value || isWaitingForThinking.value)) {
    expanded.value = true
    await nextTick()
    scrollThinkingToBottom()
  }
})
</script>

<template>
  <section v-if="normalized || hasPlaceholder || isWaitingForThinking" class="thinking-activity" :class="{ embedded, placeholder: hasPlaceholder || isWaitingForThinking }">
    <button class="thinking-header" type="button" @click="expanded = !expanded">
      <span class="thinking-rail">
        <span class="thinking-dot" :class="{ active, cancelled: status === 'cancelled' }" />
      </span>
      <span class="thinking-copy">
        <span class="thinking-row">
          <span class="thinking-title">{{ status === 'running' ? '思考中' : '思考已完成' }}</span>
          <span v-if="status === 'cancelled'" class="thinking-status">已停止</span>
        </span>
        <span v-if="!expanded" class="thinking-preview">{{ hasPlaceholder ? '模型未返回可展示的思考文本' : isWaitingForThinking ? '正在等待模型返回可展示思考内容' : preview }}</span>
      </span>
      <svg class="thinking-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
        <polyline v-if="expanded" points="6 9 12 15 18 9" />
        <polyline v-else points="9 6 15 12 9 18" />
      </svg>
    </button>

    <div v-if="expanded" class="thinking-body">
      <div class="thinking-timeline">
        <div v-if="isWaitingForThinking" class="thinking-placeholder">正在等待模型返回可展示思考内容。</div>
        <div v-else-if="hasPlaceholder" class="thinking-placeholder">模型本轮执行了思考流程，但没有返回可展示的思考文本。</div>
        <div v-else ref="contentEl" class="thinking-content">{{ normalized }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.thinking-activity {
  margin: 0 0 8px 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.thinking-activity.embedded {
  margin-left: 0;
}

.thinking-header {
  display: flex;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.thinking-header:hover {
  background: var(--hover-bg);
}

.thinking-rail {
  position: relative;
  width: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  justify-content: center;
}

.thinking-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 6px;
}

.thinking-dot.active {
  background: var(--accent);
  animation: pulse 1s ease-in-out infinite;
}

.thinking-dot.cancelled {
  background: #f59e0b;
  animation: none;
}

.thinking-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.thinking-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.thinking-title {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.thinking-status {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid #fde68a;
  border-radius: 999px;
  background: #fffbeb;
  color: #92400e;
  font-size: 10px;
  font-weight: 700;
}

.thinking-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.thinking-chevron {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--text-muted);
}

.thinking-body {
  border-top: 1px solid var(--border);
  padding: 0 12px 12px;
  background: #fbfdff;
}

.thinking-placeholder {
  padding-top: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.thinking-timeline {
  position: relative;
  margin-left: 10px;
  padding-left: 18px;
}

.thinking-timeline::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--border-strong);
}

.thinking-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  max-height: 260px;
  overflow-y: auto;
  padding-top: 10px;
}

@keyframes pulse {
  50% { opacity: 0.35; }
}

@media (max-width: 768px) {
  .thinking-activity {
    margin-left: 0;
  }
}
</style>
