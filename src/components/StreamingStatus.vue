<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ToolCall } from '../types/tools'
import type { RunState } from '../types/tools'

const props = defineProps<{
  isLoading: boolean
  activeToolCalls: ToolCall[]
  state?: RunState
  label?: string
}>()

const startedAt = ref<number | null>(null)
const now = ref(Date.now())
let timer: number | null = null

const elapsed = computed(() => {
  if (!startedAt.value) return ''
  const seconds = Math.max(0, Math.floor((now.value - startedAt.value) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
})

const label = computed(() => {
  if (props.label) return props.label
  if (props.state === 'thinking') return '思考中'
  if (props.state === 'streaming') return '生成回复'
  if (props.activeToolCalls.length > 0) {
    const latest = props.activeToolCalls[props.activeToolCalls.length - 1]
    return latest ? `运行云端工具 ${latest.name}` : '运行云端工具'
  }
  return '生成回复'
})

watch(() => props.isLoading, (loading) => {
  if (loading) {
    startedAt.value = Date.now()
    now.value = Date.now()
    timer = window.setInterval(() => {
      now.value = Date.now()
    }, 1000)
    return
  }
  startedAt.value = null
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <div v-if="isLoading" class="streaming-status" role="status" aria-live="polite">
    <span class="status-spark">
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M12 2l1.7 6.2L20 10l-6.3 1.8L12 18l-1.7-6.2L4 10l6.3-1.8L12 2z" />
      </svg>
    </span>
    <span class="status-label">{{ label }}</span>
    <span v-if="elapsed" class="status-time">{{ elapsed }}</span>
  </div>
</template>

<style scoped>
.streaming-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px 40px;
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fbfbfd;
  color: var(--text-secondary);
  font-size: 12px;
}

.status-spark {
  display: inline-flex;
  color: var(--accent);
  animation: shimmer 1.2s ease-in-out infinite;
}

.status-label {
  font-weight: 600;
  color: var(--text-primary);
}

.status-time {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

@keyframes shimmer {
  50% { opacity: 0.35; transform: scale(0.92); }
}

@media (max-width: 768px) {
  .streaming-status {
    margin-left: 0;
  }
}
</style>
