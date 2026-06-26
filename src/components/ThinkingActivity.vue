<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight } from '@lucide/vue'

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
const contentId = `thinking-content-${Math.random().toString(36).slice(2)}`
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
  <section
    v-if="normalized || hasPlaceholder || isWaitingForThinking"
    class="mb-1.5 overflow-hidden rounded-md border border-border bg-card shadow-sm"
    :class="{ 'ml-0': embedded, 'ml-8': !embedded }"
  >
    <Button
      variant="ghost"
      class="h-auto min-h-[36px] w-full justify-start gap-0 px-2.5 py-2 text-left text-muted-foreground hover:bg-accent/50"
      :aria-controls="contentId"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="relative inline-flex w-5 shrink-0 justify-center">
        <span
          class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          :class="{
            'bg-muted-foreground': !active && status !== 'cancelled',
            'animate-pulse bg-primary': active,
            'bg-amber-500': status === 'cancelled',
          }"
        />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex items-center gap-1.5">
          <span class="shrink-0 text-[11px] font-semibold text-foreground">
            {{ status === 'running' ? '思考中' : '思考已完成' }}
          </span>
          <Badge
            v-if="status === 'cancelled'"
            variant="outline"
            class="h-auto shrink-0 border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
          >
            已停止
          </Badge>
        </span>
        <span
          v-if="!expanded"
          class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground"
        >
          {{ hasPlaceholder ? '模型未返回可展示的思考文本' : isWaitingForThinking ? '正在等待模型返回可展示思考内容' : preview }}
        </span>
      </span>
      <component :is="expanded ? ChevronDown : ChevronRight" class="mt-0.5 h-[14px] w-[14px] shrink-0 text-muted-foreground/60" />
    </Button>

    <div v-if="expanded" :id="contentId" class="border-t border-border bg-muted/40 px-2.5 pb-2.5">
      <div class="relative ml-2.5 pl-4">
        <div class="absolute bottom-0 left-0 top-0 border-l border-dashed border-border" />

        <div v-if="isWaitingForThinking" class="pt-2 text-[11px] leading-relaxed text-muted-foreground">
          正在等待模型返回可展示思考内容。
        </div>
        <div v-else-if="hasPlaceholder" class="pt-2 text-[11px] leading-relaxed text-muted-foreground">
          模型本轮执行了思考流程，但没有返回可展示的思考文本。
        </div>
        <div
          v-else
          ref="contentEl"
          class="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words pt-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
        >{{ normalized }}</div>
      </div>
    </div>
  </section>
</template>
