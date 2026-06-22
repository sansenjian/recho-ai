<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span
    :class="
      cn(
        'relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>
