<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '../types'
import { buildRailTurns, clampCardTop, findActiveTurnIndex, formatTurnClock, type RailTurn } from '../utils/chat-rail'

const props = defineProps<{
  /** 对话页传入完整消息流，由轨道自己折叠成轮次。 */
  messages?: Message[]
  /**
   * 调用方已经折好轮次时直接传入（工作台按生成批次分轮）。
   * 给了它就完全接管轮次来源，不再读 messages。
   */
  turns?: RailTurn[]
  /** 对话页：当前高亮的消息 id，轨道映射到它所属的轮次。 */
  activeMessageId?: string | null
  /** 工作台：直接给出当前高亮的轮次 id。 */
  activeTurnId?: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const { t, locale } = useI18n()

/** 阶梯波浪最多 3 档：离当前轮次越远的短横越窄、越淡，在轨道上形成一段波浪。 */
const WAVE_MAX_STEP = 3
/** 32 / 24 / 18 / 12 px。加上 4px 呼吸光圈后正好落在 48px 宽的轨道里，不会被 overflow 裁掉。 */
const WAVE_WIDTHS = ['w-8', 'w-6', 'w-[18px]', 'w-3'] as const
const WAVE_OPACITIES = ['opacity-100', 'opacity-75', 'opacity-60', 'opacity-50'] as const

const CARD_ID = 'chat-rail-turn-card'
const turns = computed(() => props.turns ?? buildRailTurns(props.messages ?? []))
const activeTurnIndex = computed(() => {
  if (props.turns) return turns.value.findIndex(turn => turn.id === props.activeTurnId)
  return findActiveTurnIndex(turns.value, props.messages ?? [], props.activeMessageId ?? null)
})

function waveStep(turnIndex: number) {
  if (activeTurnIndex.value < 0) return WAVE_MAX_STEP
  return Math.min(WAVE_MAX_STEP, Math.abs(turnIndex - activeTurnIndex.value))
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

const railRef = ref<HTMLElement | null>(null)
const cardRef = ref<HTMLElement | null>(null)
const openTurnIndex = ref(-1)
const cardTop = ref(0)
const markerElements = new Map<string, HTMLButtonElement>()

const openTurn = computed(() => turns.value[openTurnIndex.value] ?? null)

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

// 卡片量到真实高度后再夹一次，避免贴底的标记把卡片顶出轨道被裁掉。
watch(openTurn, async turn => {
  if (!turn) return
  await nextTick()
  const rail = railRef.value
  const card = cardRef.value
  if (!rail || !card) return
  cardTop.value = clampCardTop(cardTop.value, rail.clientHeight, card.offsetHeight)
})

/** 卡片贴着被指向的那一格出现，所以按两者的视口坐标算纵向位置，滚动时也不会错位。 */
async function openCard(turnIndex: number) {
  const turn = turns.value[turnIndex]
  const marker = turn ? markerElements.get(turn.id) : undefined
  const rail = railRef.value
  if (!turn || !marker || !rail) return
  const offset = marker.getBoundingClientRect().top - rail.getBoundingClientRect().top
  cardTop.value = Math.max(0, offset - 10)
  openTurnIndex.value = turnIndex
  // 同一个标记再次打开时 openTurn 没有变化，上面那个 watch 不会再跑，
  // 所以这里要自己等卡片按新位置渲染完，再按真实高度夹一次，否则贴底的卡片会被裁掉。
  await nextTick()
  const card = cardRef.value
  if (!card) return
  cardTop.value = clampCardTop(cardTop.value, rail.clientHeight, card.offsetHeight)
}

function closeCard() {
  openTurnIndex.value = -1
}

function turnLabel(turnIndex: number) {
  return t('chat.jumpToTurn', { index: turnIndex + 1 })
}

function clockOf(turn: { timestamp: string }) {
  return formatTurnClock(turn.timestamp, locale.value)
}
</script>

<template>
  <!-- 窄于 960px 时整条轨道隐藏：聊天列最宽 880px + 两侧 24px 内边距，只有视口 ≥952px 时左侧沟槽才容得下 48px 宽的轨道。 -->
  <div
    v-if="turns.length"
    ref="railRef"
    data-slot="chat-turn-rail"
    class="pointer-events-auto absolute bottom-7 left-3 top-7 z-20 hidden w-12 min-[960px]:flex min-[960px]:flex-col"
    @mouseleave="closeCard"
    @keydown.escape="closeCard"
  >
    <nav
      :aria-label="t('chat.quickNav')"
      class="my-auto flex max-h-full w-12 flex-col items-start gap-2 overflow-y-auto py-1 pl-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        v-for="(turn, turnIndex) in turns"
        :key="turn.id"
        :ref="element => setMarkerElement(turn.id, element as Element | null)"
        type="button"
        class="group flex h-3 w-11 items-center border-0 bg-transparent p-0 text-left"
        :aria-current="turnIndex === activeTurnIndex ? 'true' : undefined"
        :aria-label="turnLabel(turnIndex)"
        :aria-describedby="openTurnIndex === turnIndex ? CARD_ID : undefined"
        @mouseenter="openCard(turnIndex)"
        @focus="openCard(turnIndex)"
        @blur="closeCard"
        @click="emit('select', turn.id)"
      >
        <span :class="markerClass(turnIndex)" />
      </button>
    </nav>

    <div
      v-if="openTurn"
      :id="CARD_ID"
      ref="cardRef"
      data-slot="chat-turn-card"
      role="tooltip"
      class="pointer-events-auto absolute left-full z-30 ml-2 flex w-[320px] flex-col gap-1 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md animate-in fade-in-0 slide-in-from-left-1 duration-150 motion-reduce:animate-none"
      :style="{ top: cardTop + 'px' }"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-medium">{{
          t('chat.turnCounter', { index: openTurnIndex + 1, total: turns.length })
        }}</span>
        <span v-if="clockOf(openTurn)" class="text-[11px] text-muted-foreground">{{
          clockOf(openTurn)
        }}</span>
      </div>
      <p v-if="openTurn.question" class="line-clamp-2 text-xs leading-5">
        {{ openTurn.question }}
      </p>
      <p v-if="openTurn.answer" class="line-clamp-3 text-[11px] leading-4 text-muted-foreground">
        {{ openTurn.answer }}
      </p>
      <p v-else-if="openTurn.summary" class="text-[11px] leading-4 text-muted-foreground">
        {{ openTurn.summary }}
      </p>
      <p v-else class="text-[11px] leading-4 text-muted-foreground">{{ t('chat.turnPending') }}</p>
      <p v-if="openTurn.toolCount" class="text-[11px] leading-4 text-muted-foreground">
        {{ t('chat.turnTools', { count: openTurn.toolCount }) }}
      </p>
    </div>
  </div>
</template>
