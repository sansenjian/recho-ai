<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown } from '@lucide/vue'

/**
 * 设置面板里的一个可折叠分组。
 *
 * 用标题 + 分隔线而不是嵌套卡片：外层已经是一张卡片，再套一层边框会形成
 * 「框套框套框」的碎感，也让每项的缩进层级难以辨认。
 */
const props = withDefaults(defineProps<{
  title: string
  hint?: string
  /** 默认是否展开；低频设置收起，减少主列的视觉噪音。 */
  defaultOpen?: boolean
}>(), { defaultOpen: true })

const open = ref(props.defaultOpen)
</script>

<template>
  <section data-slot="settings-group" class="border-t border-border pt-3 first:border-t-0 first:pt-0">
    <button
      type="button"
      class="flex w-full cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 pb-1 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <h3 class="m-0 text-[13px] font-semibold text-foreground">{{ props.title }}</h3>
      <span v-if="props.hint" class="flex-1 text-[11px] text-[var(--text-muted)]">{{ props.hint }}</span>
      <ChevronDown
        class="h-3.5 w-3.5 shrink-0 self-center text-[var(--text-muted)] transition-transform"
        :class="open ? 'rotate-180' : ''"
      />
    </button>
    <div v-show="open" class="flex flex-col divide-y divide-border">
      <slot />
    </div>
  </section>
</template>
