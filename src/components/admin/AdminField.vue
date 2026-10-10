<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

/**
 * 设置面板里的一个字段：左侧标签与说明，右侧控件。
 *
 * 采用左右两栏而不是上下堆叠：设置页在宽屏下有一千多像素，把标签和控件竖着摞起来
 * 会让每项都拉满整行，文字挤在左边、控件悬在右边。两栏对齐之后视线只需横向移动一次，
 * 纵向空间也省下来。
 */
const props = defineProps<{
  /** 控件 id，同时用于 label 的 for。 */
  id: string
  label: string
  hint?: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="settings-field"
    class="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:gap-4"
    :class="props.class"
  >
    <label :for="props.id" class="flex shrink-0 flex-col gap-0.5 sm:w-[220px] sm:pt-1.5">
      <span class="text-[13px] font-medium text-foreground">{{ props.label }}</span>
      <span v-if="props.hint" class="text-[11px] leading-relaxed text-[var(--text-muted)]">{{ props.hint }}</span>
    </label>
    <!--
      控件列给一个上限：输入框拉满整行时，右侧会空出大片没有内容的区域，
      而下面的列表行都是收窄的，两者左对齐后看着就不是一套网格。
    -->
    <div class="flex min-w-0 max-w-[420px] flex-1 flex-col gap-1.5">
      <slot />
      <slot name="after" />
    </div>
  </div>
</template>
