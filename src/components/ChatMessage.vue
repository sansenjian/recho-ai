<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message, MessageBlock } from '../types'
import { getRendered, getRenderedText } from '../utils/markdown'
import { stripThinking } from '../utils/messageText'
import { formatMessageTime } from '../utils/time'
import { extractLinkPreview } from '../utils/linkPreview'
import ToolActivity from './ToolActivity.vue'
import ThinkingActivity from './ThinkingActivity.vue'
import LinkPreviewCard from './LinkPreviewCard.vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from '@lucide/vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  msg: Message
  copyFeedback?: boolean
  assistantIndex?: number
  /** 当前用户对这条消息的评价：1 好评、-1 差评、0 未评价。 */
  feedback?: number
}>()

defineEmits<{
  copy: []
  retry: []
  /** 传 0 表示撤销评价。 */
  feedback: [value: number]
}>()

const { t, locale } = useI18n()

const blocks = computed(() => props.msg.blocks ?? [])
const hasBlocks = computed(() => props.msg.role === 'assistant' && blocks.value.length > 0)
const hasThinkingBlock = computed(() => blocks.value.some(block => block.type === 'thinking'))
const hasToolBlock = computed(() => blocks.value.some(block => block.type === 'tool_use'))
const shouldShowThinkingPlaceholder = computed(() =>
  props.msg.role === 'assistant' &&
  hasToolBlock.value &&
  !hasThinkingBlock.value,
)
const renderedMessage = computed(() => getRendered(props.msg))
// 时间按界面语言与「是否当天」格式化：当天只给时分，跨天补上日期。
const displayTimestamp = computed(() => formatMessageTime(props.msg.timestamp, locale.value))
const linkPreview = computed(() => extractLinkPreview(props.msg.content))

function textRendered(block: Extract<MessageBlock, { type: 'assistant_text' }>) {
  return getRenderedText(block.content)
}

function toolBlockToCall(block: Extract<MessageBlock, { type: 'tool_use' }>) {
  return {
    id: block.toolUseId,
    name: block.name,
    arguments: block.input,
    result: block.result,
    isError: block.isError,
    status: block.status,
    startedAt: block.startedAt,
    completedAt: block.completedAt,
  }
}
</script>

<template>
  <!-- Assistant message — Card-style SaaS layout -->
  <div v-if="msg.role === 'assistant'" class="group flex gap-3 items-start">
    <Avatar class="h-7 w-7 rounded-md bg-primary shadow-sm mt-0.5 shrink-0">
      <AvatarFallback class="rounded-md bg-primary text-primary-foreground text-[10px] font-mono font-bold">
        {{ assistantIndex ?? 1 }}
      </AvatarFallback>
    </Avatar>

    <div class="flex-1 min-w-0 max-w-[760px]">
      <!-- Header row -->
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-[13px] font-semibold text-foreground">Recho</span>
        <span class="text-[11px] text-muted-foreground tabular-nums" :title="msg.timestamp">{{ displayTimestamp }}</span>
      </div>

      <!-- Thinking placeholder (when tools ran but no thinking text) -->
      <ThinkingActivity
        v-if="shouldShowThinkingPlaceholder"
        embedded
        placeholder
        status="done"
      />

      <!-- Block-based content -->
      <template v-if="hasBlocks">
        <template v-for="block in blocks" :key="block.id">
          <ThinkingActivity
            v-if="block.type === 'thinking'"
            embedded
            :content="block.content"
            :status="block.status"
            :active="block.status === 'running'"
          />
          <ToolActivity
            v-else-if="block.type === 'tool_use'"
            embedded
            :active-tool-calls="block.status === 'running' ? [toolBlockToCall(block)] : []"
            :completed-tool-calls="block.status !== 'running' ? [toolBlockToCall(block)] : []"
          />
          <div
            v-else-if="block.type === 'assistant_text' && block.content"
            class="msg-text md block-text mt-1 px-3.5 py-2.5 rounded-md border border-border bg-card text-[13.5px] leading-[1.7] text-foreground font-normal break-words shadow-sm"
            :class="{ 'border-warning/40 bg-warning/10 text-warning': block.status === 'incomplete' }"
            v-html="textRendered(block)"
          />
        </template>
      </template>
      <!-- Fallback: non-block content -->
      <template v-else>
        <div v-if="renderedMessage" class="msg-text md text-[13.5px] leading-[1.7] text-foreground break-words" v-html="renderedMessage" />
        <div v-else class="msg-text text-[13.5px] leading-[1.7] text-foreground break-words">{{ stripThinking(msg.content) }}</div>
      </template>

      <LinkPreviewCard v-if="linkPreview" :preview="linkPreview" />

      <!--
        操作栏对齐 DSH 的 IconActions 规格：按钮 28px、图标 15px、间距 8px，
        默认透明、悬停或键盘聚焦时才浮现（与 DSH 一致，让正文保持干净）。
        已评价的图标换成实心，信号不再依赖颜色，鼠标移开也看得出来。
      -->
      <div class="mt-1.5 flex h-7 items-center gap-2 opacity-0 transition-opacity duration-75 group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
          :class="{ 'text-foreground': copyFeedback }"
          :title="t('chat.copy')"
          :aria-label="t('chat.copy')"
          @click="$emit('copy')"
        >
          <Check v-if="copyFeedback" class="h-[15px] w-[15px]" />
          <Copy v-else class="h-[15px] w-[15px]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
          :class="{ 'text-foreground': feedback === 1 }"
          :title="t('chat.like')"
          :aria-label="t('chat.like')"
          :aria-pressed="feedback === 1"
          @click="$emit('feedback', feedback === 1 ? 0 : 1)"
        >
          <ThumbsUp class="h-[15px] w-[15px]" :fill="feedback === 1 ? 'currentColor' : 'none'" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
          :class="{ 'text-foreground': feedback === -1 }"
          :title="t('chat.dislike')"
          :aria-label="t('chat.dislike')"
          :aria-pressed="feedback === -1"
          @click="$emit('feedback', feedback === -1 ? 0 : -1)"
        >
          <ThumbsDown class="h-[15px] w-[15px]" :fill="feedback === -1 ? 'currentColor' : 'none'" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
          :title="t('chat.retry')"
          :aria-label="t('chat.retry')"
          @click="$emit('retry')"
        >
          <RefreshCw class="h-[15px] w-[15px]" />
        </Button>
        <span class="text-[11px] tabular-nums text-muted-foreground" :title="msg.timestamp">
          {{ displayTimestamp }}
        </span>
      </div>
    </div>
  </div>

  <!-- User message — Right-aligned compact bubble -->
  <div v-else class="flex gap-3 items-start justify-end">
    <div class="flex flex-col items-end gap-1 max-w-[640px]">
      <!-- Attached images -->
      <div v-if="msg.images?.length" class="flex gap-1.5 flex-wrap mb-0.5">
        <img
          v-for="(img, i) in msg.images"
          :key="i"
          :src="img"
          class="max-w-[200px] max-h-[200px] rounded-md object-cover border border-border cursor-pointer transition-opacity hover:opacity-85"
        />
      </div>
      <!-- Text bubble -->
      <div class="msg-text text-[13.5px] leading-[1.65] text-foreground break-words bg-muted py-2 px-3 rounded-lg border border-border">
        {{ msg.content }}
      </div>
      <LinkPreviewCard v-if="linkPreview" :preview="linkPreview" />
      <!-- Actions -->
      <div class="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :class="{ 'text-primary': copyFeedback }"
          :title="t('chat.copy')"
          @click="$emit('copy')"
        >
          <Check v-if="copyFeedback" class="h-3 w-3" />
          <Copy v-else class="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          :title="t('chat.retry')"
          @click="$emit('retry')"
        >
          <RefreshCw class="h-3 w-3" />
        </Button>
        <span class="text-[11px] text-muted-foreground ml-0.5 tabular-nums" :title="msg.timestamp">{{ displayTimestamp }}</span>
      </div>
    </div>
  </div>
</template>
