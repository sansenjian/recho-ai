<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div
    :class="cn('relative overflow-auto [&>[data-scroll-area-viewport]]:h-full [&>[data-scroll-area-viewport]]:w-full', props.class)"
  >
    <div data-scroll-area-viewport class="overflow-auto">
      <slot />
    </div>
  </div>
</template>
