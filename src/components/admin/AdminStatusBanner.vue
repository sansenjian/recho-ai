<script setup lang="ts">
import { computed } from 'vue'

/**
 * 管理员面板共用的状态横幅：error 优先于 notice，两者互斥展示。
 * 六个面板此前各自内联了同一段模板（13 处 aria-live），复制出来的差异只有
 * 外边距和配色；集中在这里后，配色 / 无障碍语义只有一处可以漂移。
 */
const props = withDefaults(defineProps<{
  error?: string
  notice?: string
  /** 与相邻内容同一容器内联排布时不需要下外边距（默认需要）。 */
  flush?: boolean
}>(), {
  error: '',
  notice: '',
  flush: false,
})

const tone = computed(() => (props.error ? 'error' : props.notice ? 'notice' : ''))
const message = computed(() => props.error || props.notice)
</script>

<template>
  <div aria-live="polite" class="min-h-0">
    <p
      v-if="tone"
      data-slot="admin-status-banner"
      :data-tone="tone"
      class="inline-flex min-h-8 items-center rounded-md px-3 text-[13px] font-medium"
      :class="[flush ? '' : 'mb-2', tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success']"
    >
      {{ message }}
    </p>
  </div>
</template>
