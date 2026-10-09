<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

/**
 * 设置面板里的一个字段：标签 + 控件 + 可选说明。
 *
 * 抽出来是因为运行时配置里几乎每个设置都是这三段式，重复写会让模板被样式类淹没，
 * 加一个设置就要复制十几行。
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
  <label :for="props.id" class="flex flex-col gap-1" :class="props.class">
    <span class="text-xs font-medium text-[var(--text-muted)]">{{ props.label }}</span>
    <slot />
    <span v-if="props.hint" class="text-[11px] text-[var(--text-muted)]">{{ props.hint }}</span>
    <slot name="after" />
  </label>
</template>
