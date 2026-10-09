<script setup lang="ts">
/**
 * 设置面板里的一个「列表区块」：标题说明 + 右侧操作按钮 + 行列表 + 空态提示。
 *
 * 按模型定价、用户可见模型、Provider 模型目录都是这个形状；抽出来之后各处的
 * 间距、边框与空态文案才能保持一致，新增一类列表也不必再抄一遍结构。
 */
const props = defineProps<{
  title: string
  hint?: string
  /** 无内容时展示的提示。 */
  emptyText?: string
  /** 行列表是否为空，用于切换空态。 */
  empty: boolean
}>()
</script>

<template>
  <div data-slot="settings-section" class="flex flex-col gap-2 rounded-md border border-border bg-[var(--bubble-bg)] p-3">
    <div class="flex items-start justify-between gap-2">
      <div>
        <span class="text-xs font-medium text-[var(--text-muted)]">{{ props.title }}</span>
        <span v-if="props.hint" class="mt-0.5 block text-[11px] text-[var(--text-muted)]">{{ props.hint }}</span>
      </div>
      <div class="flex shrink-0 gap-1.5">
        <slot name="actions" />
      </div>
    </div>
    <slot />
    <span v-if="props.empty && props.emptyText" class="text-[11px] text-[var(--text-muted)]">{{ props.emptyText }}</span>
  </div>
</template>
