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
    class="border border-border rounded-md bg-card shadow-sm overflow-hidden mb-1.5"
    :class="{ 'ml-0': embedded, 'ml-8': !embedded }"
  >
    <!-- Header -->
    <button
      type="button"
      class="flex items-start w-full min-h-[36px] px-2.5 py-2 border-0 bg-transparent text-muted-foreground font-inherit cursor-pointer text-left hover:bg-accent/50 transition-colors"
      :aria-controls="contentId"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <!-- Rail + dot -->
      <span class="relative w-5 flex-shrink-0 inline-flex justify-center">
        <span
          class="w-2 h-2 rounded-full mt-1.5 shrink-0"
          :class="{
            'bg-muted-foreground': !active && status !== 'cancelled',
            'bg-primary animate-pulse': active,
            'bg-amber-500': status === 'cancelled',
          }"
        />
      </span>
      <!-- Copy -->
      <span class="min-w-0 flex-1 flex flex-col gap-0.5">
        <span class="flex items-center gap-1.5">
          <span class="shrink-0 text-[11px] font-semibold text-foreground">
            {{ status === 'running' ? '思考中' : '思考已完成' }}
          </span>
          <span
            v-if="status === 'cancelled'"
            class="shrink-0 px-1.5 py-px border border-amber-200 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
          >
            已停止
          </span>
        </span>
        <span
          v-if="!expanded"
          class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground"
        >
          {{ hasPlaceholder ? '模型未返回可展示的思考文本' : isWaitingForThinking ? '正在等待模型返回可展示思考内容' : preview }}
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
      <div class="relative ml-2.5 pl-4">
        <!-- Timeline line -->
        <div class="absolute left-0 top-0 bottom-0 border-l border-dashed border-border" />

        <div v-if="isWaitingForThinking" class="pt-2 text-muted-foreground text-[11px] leading-relaxed">
          正在等待模型返回可展示思考内容。
        </div>
        <div v-else-if="hasPlaceholder" class="pt-2 text-muted-foreground text-[11px] leading-relaxed">
          模型本轮执行了思考流程，但没有返回可展示的思考文本。
        </div>
        <div
          v-else
          ref="contentEl"
          class="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground font-mono max-h-[260px] overflow-y-auto pt-2"
        >{{ normalized }}</div>
      </div>
    </div>
  </section>
</template>
