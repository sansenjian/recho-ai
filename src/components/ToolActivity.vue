<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCall } from '../types/tools'

const props = defineProps<{
  activeToolCalls: ToolCall[]
  completedToolCalls: ToolCall[]
  embedded?: boolean
}>()

const expanded = ref(true)
const contentId = `tool-activity-${Math.random().toString(36).slice(2)}`

const tools = computed(() => [
  ...props.completedToolCalls,
  ...props.activeToolCalls,
])

const hasRunningTools = computed(() => props.activeToolCalls.some(tool => tool.status === 'running'))
const runningCount = computed(() => props.activeToolCalls.filter(tool => tool.status === 'running').length)

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

function toolLabel(name: string) {
  if (name.includes('search')) return '搜索网页'
  if (name.includes('extract')) return '提取网页'
  if (name.includes('crawl')) return '抓取站点'
  if (name.includes('map')) return '扫描站点'
  if (name.includes('research')) return '深度研究'
  return name
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
  <section
    v-if="tools.length > 0"
    class="border border-border rounded-md bg-card shadow-sm overflow-hidden mb-3.5"
    :class="{ 'mt-0 ml-0': embedded, 'ml-8 max-md:ml-0': !embedded }"
  >
    <!-- Header -->
    <button
      type="button"
      class="flex items-start w-full min-h-[36px] px-2.5 py-2 border-0 bg-transparent text-muted-foreground font-inherit cursor-pointer text-left hover:bg-accent/50 transition-colors"
      :aria-controls="contentId"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <!-- Rail + pulse dot -->
      <span class="w-5 flex-shrink-0 inline-flex justify-center">
        <span
          class="w-[7px] h-[7px] rounded-full mt-[5px] shrink-0"
          :class="{
            'bg-primary animate-pulse': hasRunningTools,
            'bg-muted-foreground': !hasRunningTools,
          }"
        />
      </span>
      <!-- Copy -->
      <span class="min-w-0 flex-1 flex flex-col gap-0.5">
        <span class="flex items-center gap-1.5">
          <span class="text-[11px] font-semibold text-foreground">
            {{ hasRunningTools ? '工具调用中' : '工具调用完成' }}
          </span>
          <span class="min-w-[20px] h-[18px] px-[5px] rounded-full bg-secondary text-muted-foreground text-[10px] font-semibold inline-flex items-center justify-center ring-1 ring-border/60">
            {{ tools.length }}
          </span>
        </span>
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground">
          {{ hasRunningTools ? `运行中 ${runningCount} 个` : title }}
        </span>
      </span>
      <!-- Chevron -->
      <svg class="shrink-0 mt-0.5 text-muted-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <polyline v-if="expanded" points="6 9 12 15 18 9" />
        <polyline v-else points="9 6 15 12 9 18" />
      </svg>
    </button>

    <!-- Body -->
    <div v-if="expanded" :id="contentId" class="border-t border-border bg-muted/40 px-2.5 pb-2.5">
      <div class="relative ml-2 pl-4">
        <!-- Timeline dashed line -->
        <div class="absolute left-0 top-0 bottom-0 border-l border-dashed border-border" />

        <article
          v-for="(tool, idx) in tools"
          :key="tool.id"
          class="relative mb-1.5 last:mb-0"
        >
          <div
            class="rounded-md bg-card flex gap-2 px-2.5 py-2 ring-1 transition-shadow"
            :class="{
              'ring-primary/25': tool.status === 'running',
              'ring-amber-400/35': isTerminalError(tool.status),
              'ring-border': tool.status === 'done' && !isTerminalError(tool.status),
            }"
          >
            <!-- Icon -->
            <span
              class="w-4 h-4 mt-px shrink-0 inline-flex items-center justify-center"
              :class="{
                'text-primary': tool.status === 'running' || tool.status === 'done',
                'text-amber-600': isTerminalError(tool.status),
              }"
            >
              <svg v-if="tool.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg v-else-if="isTerminalError(tool.status)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="7" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12" y2="17" />
              </svg>
              <svg v-else class="tool-spin" viewBox="0 0 24 24" width="13" height="13">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28 72" stroke-linecap="round" />
              </svg>
            </span>
            <!-- Content -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="font-mono text-[11px] font-semibold text-foreground truncate">{{ toolLabel(tool.name) }}</span>
                <span
                  class="shrink-0 px-1.5 py-px rounded-full text-[10px] font-semibold"
                  :class="isTerminalError(tool.status)
                    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:ring-amber-800'
                    : 'text-muted-foreground ring-1 ring-border/60'"
                >{{ statusLabel(tool.status) }}</span>
                <span class="ml-auto text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">{{ formatDuration(tool) }}</span>
              </div>
              <div
                class="mt-0.5 font-mono text-[10px] text-muted-foreground leading-snug truncate"
                :title="JSON.stringify(tool.arguments, null, 2)"
              >
                {{ compactJson(tool.arguments) }}
              </div>
              <div
                v-if="previewResult(tool.result)"
                class="mt-0.5 text-[10px] text-muted-foreground/80 leading-snug line-clamp-2"
              >
                {{ previewResult(tool.result) }}
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tool-spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
