<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  src?: string
  alt?: string
}>()
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="alt"
    :class="cn('aspect-square h-full w-full rounded-full', props.class)"
  />
</template>
