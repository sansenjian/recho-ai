<script setup lang="ts">
import { computed } from 'vue'
import type { Message } from '../types'

const props = defineProps<{
  messages: Message[]
}>()

const ESTIMATED_CONTEXT_WINDOW = 128_000

const estimatedTokens = computed(() => {
  const textChars = props.messages.reduce((sum, msg) => sum + msg.content.length, 0)
  const imageTokens = props.messages.reduce((sum, msg) => sum + (msg.images?.length ?? 0) * 850, 0)
  return Math.ceil(textChars / 3.4) + imageTokens
})

const percent = computed(() => {
  return Math.min(100, Math.round((estimatedTokens.value / ESTIMATED_CONTEXT_WINDOW) * 100))
})

const tone = computed(() => {
  if (percent.value >= 85) return 'danger'
  if (percent.value >= 65) return 'warn'
  return 'normal'
})

const ringStyle = computed(() => {
  const color = tone.value === 'danger'
    ? '#ef4444'
    : tone.value === 'warn'
      ? '#f59e0b'
      : 'var(--accent)'
  return {
    background: `conic-gradient(${color} ${percent.value * 3.6}deg, var(--input-bg) 0deg)`,
  }
})

const detail = computed(() => {
  const formatted = new Intl.NumberFormat().format(estimatedTokens.value)
  return `估算上下文 ${formatted} / ${new Intl.NumberFormat().format(ESTIMATED_CONTEXT_WINDOW)} tokens`
})
</script>

<template>
  <div class="context-meter" :class="tone" :title="detail">
    <span class="context-ring" :style="ringStyle">
      <span class="context-ring-inner" />
    </span>
    <span class="context-percent">{{ percent }}%</span>
  </div>
</template>

<style scoped>
.context-meter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-secondary);
  box-shadow: var(--shadow-sm);
}

.context-ring {
  position: relative;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.context-ring-inner {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--surface);
}

.context-percent {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.context-meter.warn {
  border-color: rgba(245, 158, 11, 0.35);
}

.context-meter.danger {
  border-color: rgba(239, 68, 68, 0.35);
}

@media (max-width: 640px) {
  .context-meter {
    display: none;
  }
}
</style>
