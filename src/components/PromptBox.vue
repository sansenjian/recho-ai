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

/**
 * 内置 textarea 的 Enter 提交。
 *
 * 组合输入（中文/日文/韩文）期间按 Enter 是在选定候选词，不是提交。浏览器会在
 * compositionend 之前先派发一次 isComposing 为 true 的 keydown；也有实现是先
 * compositionend 再派发最终的 keydown，此时只能靠已废弃的 keyCode === 229 兜底。
 * 两者都要挡，否则选词就把半截输入发出去了。
 */
function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  emit('submit')
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
        class="prompt-input block w-full resize-none border-0 bg-transparent p-1 text-sm leading-[1.7] text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        :style="{ minHeight }"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="ariaLabel"
        rows="1"
        @input="handleInput"
        @keydown.enter.exact="handleKeydown"
      />
    </slot>

    <div class="mt-2 flex min-w-0 items-center gap-2 max-sm:flex-wrap">
      <slot name="actions-left" />
      <div class="prompt-actions-end ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5 max-sm:w-full max-sm:basis-full">
        <slot name="actions-right" />
      </div>
    </div>
  </div>
</template>
