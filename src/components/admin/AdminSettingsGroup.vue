<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown } from '@lucide/vue'

/**
 * 设置面板里的一个可折叠分组。
 *
 * 运行时配置原先是一列平铺九项，改价、选模型、开关混在一起，既看不出哪些是一组的，
 * 也找不到重点。分组之后每一类各有标题与说明，低频项默认收起，主列只留常用的。
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
  <section data-slot="settings-group" class="rounded-md border border-border bg-[var(--surface)]">
    <button
      type="button"
      class="flex w-full cursor-pointer items-start justify-between gap-3 border-0 bg-transparent px-4 py-3 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="min-w-0">
        <span class="block text-[13px] font-semibold text-foreground">{{ props.title }}</span>
        <span v-if="props.hint" class="mt-0.5 block text-[11px] text-[var(--text-muted)]">{{ props.hint }}</span>
      </span>
      <ChevronDown
        class="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform"
        :class="open ? 'rotate-180' : ''"
      />
    </button>
    <div v-show="open" class="flex flex-col gap-3 border-t border-border px-4 py-3">
      <slot />
    </div>
  </section>
</template>
