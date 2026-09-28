<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../types'

const props = defineProps<{
  messages: Message[]
  activeMessageId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const { t } = useI18n()

/** 阶梯波浪最多 3 档：离当前轮次越远的短横越窄、越淡，在轨道上形成一段波浪。 */
const WAVE_MAX_STEP = 3
/** 32 / 24 / 18 / 12 px。加上 4px 呼吸光圈后正好落在 48px 宽的轨道里，不会被 overflow 裁掉。 */
const WAVE_WIDTHS = ['w-8', 'w-6', 'w-[18px]', 'w-3'] as const
const WAVE_OPACITIES = ['opacity-100', 'opacity-75', 'opacity-60', 'opacity-50'] as const

const activeIndex = computed(() =>
  props.activeMessageId
    ? props.messages.findIndex(message => message.id === props.activeMessageId)
    : -1,
)

function waveStep(index: number) {
  if (activeIndex.value < 0) return WAVE_MAX_STEP
  return Math.min(WAVE_MAX_STEP, Math.abs(index - activeIndex.value))
}

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

function jumpLabel(message: Message) {
  return t('chat.jumpToMessage', {
    target: message.role === 'assistant' ? t('chat.jumpToAssistant') : t('chat.jumpToMine'),
    index: props.messages.indexOf(message) + 1,
  })
}

function markerClass(message: Message, index: number) {
  const isActive = message.id === props.activeMessageId
  const step = waveStep(index)
  return [
    'h-[3px] rounded-full transition-[width,background-color,opacity,box-shadow] duration-200 ease-[cubic-bezier(.22,.75,.18,1)] motion-reduce:transition-none',
    WAVE_WIDTHS[step],
    isActive || message.role === 'assistant' ? 'bg-foreground' : 'bg-muted-foreground',
    isActive
      ? 'opacity-100 animate-turn-marker-pulse motion-reduce:animate-none'
      : [WAVE_OPACITIES[step], 'group-hover:w-8 group-hover:opacity-100'],
  ]
}
</script>

<template>
  <nav
    v-if="messages.length"
    :aria-label="t('chat.quickNav')"
    class="pointer-events-auto absolute left-3 top-7 z-10 hidden max-h-[calc(100%-56px)] w-12 flex-col items-start gap-2 overflow-y-auto py-1 pl-1 [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden"
  >
    <button
      v-for="(message, index) in messages"
      :key="message.id"
      :ref="element => setMarkerElement(message.id, element as Element | null)"
      type="button"
      class="group flex h-3 w-11 items-center border-0 bg-transparent p-0 text-left"
      :aria-current="message.id === activeMessageId ? 'true' : undefined"
      :aria-label="jumpLabel(message)"
      :title="jumpLabel(message)"
      @click="emit('select', message.id)"
    >
      <span :class="markerClass(message, index)" />
    </button>
  </nav>
</template>
