<script setup lang="ts">
/**
 * 二选一的分段切换器。
 *
 * 「对话 / 画布」「生成 / 画布」这类模式选择在侧栏里出现了多次，此前是整段按钮标记
 * 连样式一起复制——改一处文案要记得改另一处，漏掉就出现两套长得一样的控件。这里把
 * 选中态、按钮尺寸与间距收成一份，调用方只声明选项。
 */
export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

const props = defineProps<{
  options: ReadonlyArray<SegmentedOption<string>>
  modelValue: string
  /** 外层容器的间距。两个侧栏的留白不同，由调用方决定。 */
  containerClass?: string
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function isActive(value: string) {
  return props.modelValue === value
}
</script>

<template>
  <div
    class="flex items-center gap-2 rounded-lg border border-border bg-muted p-1"
    :class="containerClass"
    role="group"
    :aria-label="ariaLabel"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="flex-1 min-h-[34px] rounded-md border-0 px-3 py-0 text-[13px] font-extrabold transition-all duration-200"
      :class="isActive(option.value)
        ? 'bg-background text-foreground shadow-sm'
        : 'bg-transparent text-muted-foreground hover:text-foreground'"
      :aria-pressed="isActive(option.value)"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
