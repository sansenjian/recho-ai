<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCall } from '../types/tools'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight } from '@lucide/vue'

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
    class="mb-3.5 overflow-hidden rounded-md border border-border bg-card shadow-sm"
    :class="{ 'mt-0 ml-0': embedded, 'ml-8 max-md:ml-0': !embedded }"
  >
    <Button
      variant="ghost"
      class="h-auto min-h-[36px] w-full justify-start gap-0 px-2.5 py-2 text-left text-muted-foreground hover:bg-accent/50"
      :aria-controls="contentId"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="inline-flex w-5 shrink-0 justify-center">
        <span
          class="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full"
          :class="{
            'animate-pulse bg-primary': hasRunningTools,
            'bg-muted-foreground': !hasRunningTools,
          }"
        />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex items-center gap-1.5">
          <span class="text-[11px] font-semibold text-foreground">
            {{ hasRunningTools ? '工具调用中' : '工具调用完成' }}
          </span>
          <Badge variant="secondary" class="h-[18px] px-[5px] text-[10px] font-semibold">
            {{ tools.length }}
          </Badge>
        </span>
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground">
          {{ hasRunningTools ? `运行中 ${runningCount} 个` : title }}
        </span>
      </span>
      <component :is="expanded ? ChevronDown : ChevronRight" class="mt-0.5 h-[14px] w-[14px] shrink-0 text-muted-foreground/60" />
    </Button>

    <div v-if="expanded" :id="contentId" class="border-t border-border bg-muted/40 px-2.5 pb-2.5">
      <div class="relative ml-2 pl-4">
        <div class="absolute bottom-0 left-0 top-0 border-l border-dashed border-border" />

        <article
          v-for="(tool, idx) in tools"
          :key="tool.id"
          class="relative mb-1.5 last:mb-0"
        >
          <div
            class="flex gap-2 rounded-md bg-card px-2.5 py-2 ring-1 transition-shadow"
            :class="{
              'ring-primary/25': tool.status === 'running',
              'ring-amber-400/35': isTerminalError(tool.status),
              'ring-border': tool.status === 'done' && !isTerminalError(tool.status),
            }"
          >
            <span
              class="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center"
              :class="{
                'text-primary': tool.status === 'running' || tool.status === 'done',
                'text-amber-600': isTerminalError(tool.status),
              }"
            >
              <CheckCircle2 v-if="tool.status === 'done'" class="h-[13px] w-[13px]" />
              <AlertCircle v-else-if="isTerminalError(tool.status)" class="h-[13px] w-[13px]" />
              <Loader2 v-else class="h-[13px] w-[13px] animate-spin" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate font-mono text-[11px] font-semibold text-foreground">{{ toolLabel(tool.name) }}</span>
                <Badge
                  class="h-auto shrink-0 px-1.5 py-px text-[10px] font-semibold"
                  :variant="isTerminalError(tool.status) ? 'destructive' : 'outline'"
                >
                  {{ statusLabel(tool.status) }}
                </Badge>
                <span class="ml-auto whitespace-nowrap text-[10px] text-muted-foreground tabular-nums">{{ formatDuration(tool) }}</span>
              </div>
              <div
                class="mt-0.5 truncate font-mono text-[10px] leading-snug text-muted-foreground"
                :title="JSON.stringify(tool.arguments, null, 2)"
              >
                {{ compactJson(tool.arguments) }}
              </div>
              <div
                v-if="previewResult(tool.result)"
                class="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground/80"
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
