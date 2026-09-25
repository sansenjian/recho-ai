<script setup lang="ts">
import { nextTick, watch } from 'vue'
import type { Message } from '../types'

const props = defineProps<{
  messages: Message[]
  activeMessageId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const markerElements = new Map<string, HTMLButtonElement>()

function setMarkerElement(id: string, element: Element | null) {
  if (element instanceof HTMLButtonElement) markerElements.set(id, element)
  else markerElements.delete(id)
}

function scrollActiveMarkerIntoView() {
  if (!props.activeMessageId) return
  const marker = markerElements.get(props.activeMessageId)
  if (marker && typeof marker.scrollIntoView === 'function') {
    marker.scrollIntoView({ block: 'nearest' })
  }
}

watch(() => props.activeMessageId, () => {
  void nextTick(scrollActiveMarkerIntoView)
})

function lineClass(message: Message) {
  return [
    'h-[3px] rounded-full transition-all duration-200',
    message.id === props.activeMessageId
      ? 'w-9 bg-foreground'
      : message.role === 'assistant'
        ? 'w-5 bg-muted-foreground/35'
        : 'w-3 bg-muted-foreground/25',
  ]
}
</script>

<template>
  <nav
    v-if="messages.length"
    aria-label="对话快捷导航"
    class="pointer-events-auto absolute left-3 top-7 z-10 hidden max-h-[calc(100%-56px)] w-10 flex-col items-start gap-3 overflow-y-auto py-1 lg:flex"
  >
    <button
      v-for="message in messages"
      :key="message.id"
      :ref="element => setMarkerElement(message.id, element as Element | null)"
      type="button"
      class="flex h-3 w-10 items-center border-0 bg-transparent p-0 text-left"
      :aria-label="`${message.role === 'assistant' ? '跳转到 AI 回复' : '跳转到我的消息'}第 ${messages.indexOf(message) + 1} 条`"
      :title="`${message.role === 'assistant' ? '跳转到 AI 回复' : '跳转到我的消息'}第 ${messages.indexOf(message) + 1} 条`"
      @click="emit('select', message.id)"
    >
      <span :class="lineClass(message)" />
    </button>
  </nav>
</template>
