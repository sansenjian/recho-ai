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

/** 轨道只索引真实提问：一条用户消息 = 一格，助手回复和流式分片不占格子。 */
interface RailTurn {
  /** 这一轮提问的消息 id，也是点击后跳转到的锚点（即该轮起点）。 */
  id: string
  /** 该消息在 messages 里的下标，用来把滚动位置映射回轮次。 */
  messageIndex: number
}

/** 阶梯波浪最多 3 档：离当前轮次越远的短横越窄、越淡，在轨道上形成一段波浪。 */
const WAVE_MAX_STEP = 3
/** 32 / 24 / 18 / 12 px。加上 4px 呼吸光圈后正好落在 48px 宽的轨道里，不会被 overflow 裁掉。 */
const WAVE_WIDTHS = ['w-8', 'w-6', 'w-[18px]', 'w-3'] as const
const WAVE_OPACITIES = ['opacity-100', 'opacity-75', 'opacity-60', 'opacity-50'] as const

const turns = computed<RailTurn[]>(() => {
  const list: RailTurn[] = []
  props.messages.forEach((message, messageIndex) => {
    if (message.role === 'user') list.push({ id: message.id, messageIndex })
  })
  return list
})

/** 当前消息落在哪一轮：两轮之间的助手回复归属于它前面那一轮。 */
const activeTurnIndex = computed(() => {
  if (!turns.value.length) return -1
  const messageIndex = props.messages.findIndex(message => message.id === props.activeMessageId)
  if (messageIndex < 0) return -1
  let turnIndex = -1
  for (const [index, turn] of turns.value.entries()) {
    if (turn.messageIndex > messageIndex) break
    turnIndex = index
  }
  return Math.max(0, turnIndex)
})

function waveStep(turnIndex: number) {
  if (activeTurnIndex.value < 0) return WAVE_MAX_STEP
  return Math.min(WAVE_MAX_STEP, Math.abs(turnIndex - activeTurnIndex.value))
}

const markerElements = new Map<string, HTMLButtonElement>()

function setMarkerElement(id: string, element: Element | null) {
  if (element instanceof HTMLButtonElement) markerElements.set(id, element)
  else markerElements.delete(id)
}

function scrollActiveMarkerIntoView() {
  const turn = turns.value[activeTurnIndex.value]
  if (!turn) return
  const marker = markerElements.get(turn.id)
  if (marker && typeof marker.scrollIntoView === 'function') {
    marker.scrollIntoView({ block: 'nearest' })
  }
}

watch(activeTurnIndex, () => {
  void nextTick(scrollActiveMarkerIntoView)
})

function turnLabel(turnIndex: number) {
  return t('chat.jumpToTurn', { index: turnIndex + 1 })
}

function markerClass(turnIndex: number) {
  const isActive = turnIndex === activeTurnIndex.value
  const step = waveStep(turnIndex)
  return [
    'h-[3px] rounded-full bg-foreground transition-[width,background-color,opacity,box-shadow] duration-200 ease-[cubic-bezier(.22,.75,.18,1)] motion-reduce:transition-none',
    WAVE_WIDTHS[step],
    isActive
      ? 'opacity-100 animate-turn-marker-pulse motion-reduce:animate-none'
      : [WAVE_OPACITIES[step], 'group-hover:w-8 group-hover:opacity-100'],
  ]
}
</script>

<template>
  <nav
    v-if="turns.length"
    :aria-label="t('chat.quickNav')"
    class="pointer-events-auto absolute left-3 top-7 z-10 hidden max-h-[calc(100%-56px)] w-12 flex-col items-start gap-2 overflow-y-auto py-1 pl-1 [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden"
  >
    <button
      v-for="(turn, turnIndex) in turns"
      :key="turn.id"
      :ref="element => setMarkerElement(turn.id, element as Element | null)"
      type="button"
      class="group flex h-3 w-11 items-center border-0 bg-transparent p-0 text-left"
      :aria-current="turnIndex === activeTurnIndex ? 'true' : undefined"
      :aria-label="turnLabel(turnIndex)"
      :title="turnLabel(turnIndex)"
      @click="emit('select', turn.id)"
    >
      <span :class="markerClass(turnIndex)" />
    </button>
  </nav>
</template>
