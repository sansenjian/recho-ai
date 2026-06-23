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

const ringColor = computed(() => {
  if (tone.value === 'danger') return '#ef4444'
  if (tone.value === 'warn') return '#f59e0b'
  return 'hsl(var(--foreground))'
})

const ringStyle = computed(() => ({
  background: `conic-gradient(${ringColor.value} ${percent.value * 3.6}deg, hsl(var(--muted)) 0deg)`,
}))

const detail = computed(() => {
  const formatted = new Intl.NumberFormat().format(estimatedTokens.value)
  return `估算上下文 ${formatted} / ${new Intl.NumberFormat().format(ESTIMATED_CONTEXT_WINDOW)} tokens`
})
</script>

<template>
  <div
    class="inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-secondary text-muted-foreground text-[10px] font-medium font-mono max-[640px]:hidden cursor-default"
    :class="{
      'ring-1 ring-amber-400/30': tone === 'warn',
      'ring-1 ring-red-400/30': tone === 'danger',
    }"
    :title="detail"
  >
    <span
      class="relative w-3 h-3 rounded-full inline-flex items-center justify-center shrink-0"
      :style="ringStyle"
    >
      <span class="w-1.5 h-1.5 rounded-full bg-secondary" />
    </span>
    <span>{{ percent }}%</span>
  </div>
</template>
