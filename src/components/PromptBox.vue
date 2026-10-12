<script setup lang="ts">
/**
 * 提示词输入框的外壳。
 *
 * chat 与工作台的输入区此前各写一套外框：一个靠三档静态阴影表达「这是输入框」，
 * 另一个不加深影、只让焦点环承担高亮。两页都会继续长功能（工作台还要加思考、搜索），
 * 与其让差异继续扩散，不如把外框、焦点态、底部操作行的排布固定在这里。
 *
 * 外框规格取自工作台：边框表达边界，焦点才高亮。chat 原来的静态阴影一并去掉。
 *
 * 输入控件本身由调用方给：chat 需要自己处理技能菜单与回车提交，工作台的 textarea
 * 是简单绑值。默认插槽为空时用这里内置的 textarea。
 */
withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  /** 内置 textarea 的最小高度。工作台比 chat 高，因为它下面还要放一行参数控件。 */
  minHeight?: string
  ariaLabel?: string
}>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  minHeight: '108px',
  ariaLabel: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div
    class="flex w-full flex-col rounded-lg border border-border bg-card px-3.5 py-3 transition-[border-color,box-shadow] duration-200 focus-within:border-ring focus-within:shadow-[0_0_0_2px_hsl(var(--ring)/0.14)]"
  >
    <slot name="above" />

    <slot name="attachments" />

    <slot>
      <textarea
        data-slot="prompt-input"
        class="prompt-input block w-full resize-none border-0 bg-transparent p-1 text-sm leading-[1.7] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        :style="{ minHeight }"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="ariaLabel"
        rows="1"
        @input="handleInput"
        @keydown.enter.exact.prevent="emit('submit')"
      />
    </slot>

    <div class="mt-2 flex min-w-0 items-center gap-2 max-sm:flex-wrap">
      <slot name="actions-left" />
      <div class="prompt-actions-end ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5 max-sm:w-full max-sm:flex-basis-full">
        <slot name="actions-right" />
      </div>
    </div>
  </div>
</template>
