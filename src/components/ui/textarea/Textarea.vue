<script setup lang="ts">
import { type HTMLAttributes, useTemplateRef } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  modelValue?: string
  defaultValue?: string
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()

const textareaRef = useTemplateRef<HTMLTextAreaElement>('textareaRef')

defineExpose({
  textareaRef,
})
</script>

<template>
  <textarea
    ref="textareaRef"
    :class="cn(
      'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      props.class,
    )"
    :value="modelValue ?? defaultValue"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
