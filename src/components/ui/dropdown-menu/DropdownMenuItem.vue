<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
  disabled?: boolean
  inset?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  inset: false,
})

const emit = defineEmits<{
  select: []
}>()

function onClick() {
  if (!props.disabled) emit('select')
}
</script>

<template>
  <button
    :class="cn(
      'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
      'hover:bg-accent hover:text-accent-foreground',
      'focus:bg-accent focus:text-accent-foreground',
      disabled && 'pointer-events-none opacity-50',
      inset && 'pl-8',
      props.class
    )"
    :disabled="disabled"
    role="menuitem"
    @click="onClick"
  >
    <slot />
  </button>
</template>
