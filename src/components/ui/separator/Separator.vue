<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
}>()

const delegatedProps = computed(() => {
  const { class: _, ...otherProps } = props
  return otherProps
})
</script>

<template>
  <div
    v-bind="delegatedProps"
    :class="
      cn(
        'shrink-0 bg-border',
        orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full',
        props.class,
      )
    "
    role="separator"
  />
</template>
