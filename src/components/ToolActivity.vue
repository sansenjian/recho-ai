<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCall } from '../types/tools'

const props = defineProps<{
  activeToolCalls: ToolCall[]
  completedToolCalls: ToolCall[]
  embedded?: boolean
}>()

const expanded = ref(true)

const tools = computed(() => [
  ...props.completedToolCalls,
  ...props.activeToolCalls,
])

const hasRunningTools = computed(() => props.activeToolCalls.some(tool => tool.status === 'running'))

const title = computed(() => {
  const counts = new Map<string, number>()
  for (const tool of tools.value) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  }
  const summary = [...counts.entries()]
    .slice(-3)
    .map(([name, count]) => count > 1 ? `${name} x${count}` : name)
    .join(' · ')
  return summary || '云端工具活动'
})

function formatDuration(tool: ToolCall) {
  if (!tool.startedAt) return ''
  const end = tool.completedAt || Date.now()
  const seconds = Math.max(0, Math.round((end - tool.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function compactJson(value: Record<string, unknown>) {
  const keys = Object.keys(value)
  if (keys.length === 0) return '无参数'
  return keys
    .slice(0, 3)
    .map((key) => {
      const raw = value[key]
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      return `${key}: ${text?.slice(0, 64) ?? ''}`
    })
    .join(' · ')
}

function previewResult(result?: string) {
  const text = (result || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 180 ? `${text.slice(0, 180)}...` : text
}

function statusLabel(status = 'running') {
  if (status === 'done') return '完成'
  if (status === 'error') return '失败'
  if (status === 'timeout') return '超时'
  if (status === 'cancelled') return '已停止'
  return '运行中'
}

function isTerminalError(status?: string) {
  return status === 'error' || status === 'timeout' || status === 'cancelled'
}
</script>

<template>
  <section v-if="tools.length > 0" class="tool-activity" :class="{ embedded }">
    <button class="tool-activity-header" type="button" @click="expanded = !expanded">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
        <polyline v-if="expanded" points="6 9 12 15 18 9" />
        <polyline v-else points="9 6 15 12 9 18" />
      </svg>
      <span class="tool-activity-title">{{ title }}</span>
      <span v-if="hasRunningTools" class="tool-activity-pulse" />
      <span class="tool-activity-count">{{ tools.length }}</span>
    </button>

    <div v-if="expanded" class="tool-activity-body">
      <article v-for="tool in tools" :key="tool.id" class="tool-card" :class="{ running: tool.status === 'running', failed: isTerminalError(tool.status) }">
        <div class="tool-card-main">
          <span class="tool-icon">
            <svg v-if="tool.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg v-else-if="isTerminalError(tool.status)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="7" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12" y2="17" />
            </svg>
            <svg v-else class="tool-spin" viewBox="0 0 24 24" width="14" height="14">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28 72" stroke-linecap="round" />
            </svg>
          </span>
          <div class="tool-card-copy">
            <div class="tool-card-topline">
              <span class="tool-name">{{ tool.name }}</span>
              <span class="tool-status" :class="{ failed: isTerminalError(tool.status) }">{{ statusLabel(tool.status) }}</span>
              <span class="tool-duration">{{ formatDuration(tool) }}</span>
            </div>
            <div class="tool-args" :title="JSON.stringify(tool.arguments, null, 2)">
              {{ compactJson(tool.arguments) }}
            </div>
            <div v-if="previewResult(tool.result)" class="tool-result">
              {{ previewResult(tool.result) }}
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.tool-activity {
  margin: 4px 0 16px 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fbfbfd;
  overflow: hidden;
}

.tool-activity.embedded {
  margin-top: 0;
}

.tool-activity-header {
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

.tool-activity-header:hover {
  background: var(--hover-bg);
}

.tool-activity-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.tool-activity-count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tool-activity-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1s ease-in-out infinite;
}

.tool-activity-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border);
}

.tool-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.tool-card.running {
  border-color: rgba(99, 102, 241, 0.34);
}

.tool-card.failed {
  border-color: rgba(245, 158, 11, 0.42);
}

.tool-card-main {
  display: flex;
  gap: 9px;
  padding: 9px 10px;
}

.tool-icon {
  width: 18px;
  height: 18px;
  margin-top: 1px;
  color: #16a34a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.running .tool-icon {
  color: var(--accent);
}

.failed .tool-icon {
  color: #d97706;
}

.tool-card-copy {
  min-width: 0;
  flex: 1;
}

.tool-card-topline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-name {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.tool-status {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.tool-status.failed {
  border-color: #fde68a;
  background: #fffbeb;
  color: #92400e;
}

.tool-duration {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tool-args,
.tool-result {
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.tool-args {
  white-space: nowrap;
  font-family: var(--font-mono);
}

.tool-result {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.tool-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  50% { opacity: 0.35; }
}

@media (max-width: 768px) {
  .tool-activity {
    margin-left: 0;
  }
}
</style>
