<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

interface ModelOption {
  value: string
  label: string
}

const props = defineProps<{
  modelValue?: string
  defaultModel?: string
  options?: ModelOption[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const options = computed(() => props.options ?? [])
const defaultOption = computed(() => options.value.find(option => option.value === props.defaultModel) ?? null)
const recommendedOptions = computed(() => options.value.filter(option => option.value !== props.defaultModel))
const selectedOption = computed(() => options.value.find(option => option.value === props.modelValue) ?? null)
const selectedLabel = computed(() => selectedOption.value?.label || defaultOption.value?.label || '选择模型')

function selectModel(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) open.value = false
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <div ref="rootRef" class="relative min-w-0">
    <button
      type="button"
      class="image-model-trigger"
      :disabled="disabled || !options.length"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open = !open"
    >
      <span class="min-w-0 truncate">{{ selectedLabel }}</span>
      <ChevronDown class="h-3.5 w-3.5 shrink-0 opacity-70" />
    </button>

    <div v-if="open && options.length" class="image-model-menu" role="listbox" aria-label="选择模型">
      <div class="image-model-menu-title">选择模型</div>

      <div v-if="defaultOption" class="image-model-group">
        <div class="image-model-group-label">默认</div>
        <button
          type="button"
          role="option"
          class="image-model-option"
          :aria-selected="defaultOption.value === modelValue"
          @click="selectModel(defaultOption.value)"
        >
          <span class="truncate">{{ defaultOption.label }}</span>
          <Check v-if="defaultOption.value === modelValue" class="h-4 w-4 shrink-0" />
        </button>
      </div>

      <div v-if="recommendedOptions.length" class="image-model-group">
        <div class="image-model-group-label">推荐模型集</div>
        <button
          v-for="option in recommendedOptions"
          :key="option.value"
          type="button"
          role="option"
          class="image-model-option"
          :aria-selected="option.value === modelValue"
          @click="selectModel(option.value)"
        >
          <span class="truncate">{{ option.label }}</span>
          <Check v-if="option.value === modelValue" class="h-4 w-4 shrink-0" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-model-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 0 11px;
  border: 0;
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.image-model-trigger:hover:not(:disabled),
.image-model-trigger[aria-expanded='true'] {
  background: hsl(var(--accent));
}

.image-model-trigger:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

.image-model-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.image-model-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 9px);
  z-index: 50;
  width: min(300px, calc(100vw - 32px));
  max-height: min(430px, calc(100vh - 180px));
  overflow-y: auto;
  padding: 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--popover));
  box-shadow: 0 18px 60px hsl(var(--foreground) / 0.14);
  scrollbar-color: hsl(var(--muted-foreground) / 0.22) transparent;
  scrollbar-width: thin;
}

.image-model-menu-title {
  padding: 3px 10px 8px;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
}

.image-model-group + .image-model-group {
  margin-top: 4px;
}

.image-model-group-label {
  padding: 5px 10px 3px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.image-model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 7px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: hsl(var(--foreground));
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.image-model-option:hover,
.image-model-option[aria-selected='true'] {
  background: hsl(var(--muted));
}

@media (max-width: 640px) {
  .image-model-menu {
    right: auto;
    left: 0;
    width: min(300px, calc(100vw - 40px));
  }
}
</style>
