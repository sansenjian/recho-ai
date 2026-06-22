<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ToolCall } from '../types/tools'
import type { RunState } from '../types/tools'
import { Badge } from '@/components/ui/badge'
import { Sparkles } from '@lucide/vue'

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
  <Badge
    v-if="isLoading"
    variant="secondary"
    class="gap-1 ml-6 mb-1.5 h-5.5 py-0.5 px-2 text-[10px] font-medium rounded-md max-md:ml-0 animate-in fade-in-0"
    role="status"
    aria-live="polite"
  >
    <Sparkles class="h-3 w-3 text-primary animate-pulse" />
    <span class="font-medium text-foreground">{{ label }}</span>
    <span v-if="elapsed" class="text-muted-foreground tabular-nums">{{ elapsed }}</span>
  </Badge>
</template>
