<script setup lang="ts">
/**
 * 设置面板里的一个「列表区块」：左侧标题、说明与操作按钮，右侧是行列表。
 *
 * 与 AdminField 共用两栏骨架（同样的 220px 标签列），这样同一张卡片里所有项的
 * 控件左边缘都对齐在一条竖线上——列宽不一致时那条线会来回错位，看着很毛糙。
 */
const props = defineProps<{
  title: string
  hint?: string
  /** 无内容时展示的提示，跟在行列表的位置，而不是飘到标题那一侧。 */
  emptyText?: string
  /** 行列表是否为空，用于切换空态。 */
  empty: boolean
}>()
</script>

<template>
  <div data-slot="settings-section" class="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:gap-4">
    <div class="flex shrink-0 flex-col gap-1 sm:w-[220px]">
      <div class="flex flex-col gap-0.5">
        <span class="text-[13px] font-medium text-foreground">{{ props.title }}</span>
        <span v-if="props.hint" class="text-[11px] leading-relaxed text-[var(--text-muted)]">{{ props.hint }}</span>
      </div>
      <div class="flex flex-wrap gap-1.5 pt-0.5">
        <slot name="actions" />
      </div>
    </div>
    <div class="flex min-w-0 max-w-[640px] flex-1 flex-col gap-1.5">
      <slot />
      <span v-if="props.empty && props.emptyText" class="text-[11px] text-[var(--text-muted)]">{{ props.emptyText }}</span>
      <span v-else-if="props.empty" class="text-[11px] text-[var(--text-muted)]">—</span>
    </div>
  </div>
</template>
