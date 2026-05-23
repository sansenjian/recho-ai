<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  content?: string
  active?: boolean
  status?: 'running' | 'done' | 'cancelled'
  embedded?: boolean
}>()

const expanded = ref(false)

const normalized = computed(() => (props.content || '').trim())
const lines = computed(() => normalized.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
const preview = computed(() => {
  const first = lines.value[0] || ''
  return first.length > 96 ? `${first.slice(0, 96)}...` : first
})

watch(() => props.active, (active) => {
  if (active && normalized.value) expanded.value = true
})
</script>

<template>
  <section v-if="normalized" class="thinking-activity" :class="{ embedded }">
    <button class="thinking-header" type="button" @click="expanded = !expanded">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
        <polyline v-if="expanded" points="6 9 12 15 18 9" />
        <polyline v-else points="9 6 15 12 9 18" />
      </svg>
      <span class="thinking-dot" :class="{ active, cancelled: status === 'cancelled' }" />
      <span class="thinking-title">思考过程</span>
      <span v-if="status === 'cancelled'" class="thinking-status">已停止</span>
      <span v-if="!expanded" class="thinking-preview">{{ preview }}</span>
    </button>

    <div v-if="expanded" class="thinking-body">
      <div class="thinking-content">{{ normalized }}</div>
    </div>
  </section>
</template>

<style scoped>
.thinking-activity {
  margin: 0 0 8px 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fbfbfd;
  overflow: hidden;
}

.thinking-activity.embedded {
  margin-left: 0;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 7px 10px;
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

.thinking-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}

.thinking-dot.active {
  background: var(--accent);
  animation: pulse 1s ease-in-out infinite;
}

.thinking-dot.cancelled {
  background: #f59e0b;
  animation: none;
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
  font-size: 11px;
  color: var(--text-secondary);
}

.thinking-body {
  border-top: 1px solid var(--border);
  padding: 10px 12px;
}

.thinking-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.thinking-content {
  font-family: var(--font-mono);
  max-height: 260px;
  overflow-y: auto;
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
