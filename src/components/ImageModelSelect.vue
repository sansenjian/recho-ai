<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

import { MENU_MAX_HEIGHT, placeMenu } from '../utils/floating-placement'

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

const { t } = useI18n()

// useId() 让同页多实例不撞 id;aria-activedescendant 必须能对上重新渲染出来的选项。
const baseId = useId()
const listboxId = `${baseId}-listbox`
const titleId = `${baseId}-title`
const defaultGroupLabelId = `${baseId}-group-default`
const recommendedGroupLabelId = `${baseId}-group-recommended`

const open = ref(false)
const activeIndex = ref(-1)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const listboxRef = ref<HTMLElement | null>(null)

// 菜单朝上还是朝下、最高能有多高,由触发器的真实位置量出来。
// 纯 CSS 的 `bottom: 100%` 配一个写死的 calc 高度,窗口一变矮或菜单一变长就会被顶出视口。
const placementSide = ref<'up' | 'down'>('up')
const menuMaxHeight = ref(MENU_MAX_HEIGHT)
const menuShift = ref(0)
const menuStyle = computed(() => ({
  '--image-model-menu-max-height': `${menuMaxHeight.value}px`,
  '--image-model-menu-shift': `${menuShift.value}px`,
}))

let resizeObserver: ResizeObserver | null = null

// 触发器的视口位置会随滚动/窗口变化,所以每次开菜单、每次 resize/scroll 都要重新量。
function updatePlacement() {
  const trigger = triggerRef.value
  const menu = listboxRef.value
  if (!open.value || !trigger || !menu) return

  const triggerRect = trigger.getBoundingClientRect()
  const placement = placeMenu({
    triggerTop: triggerRect.top,
    triggerBottom: triggerRect.bottom,
    // 这里刻意用布局盒而不是 getBoundingClientRect:入场动画带 scale(0.98),
    // 量到的是缩放后的宽度,右边距会算少约 2%;offsetLeft/offsetWidth 不含 transform,
    // 而且天然就是「未平移」的自然位置,不必再手动减掉已施加的位移。
    menuLeft: (rootRef.value?.getBoundingClientRect().left ?? 0) + menu.offsetLeft,
    menuWidth: menu.offsetWidth,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })

  placementSide.value = placement.side
  menuMaxHeight.value = placement.maxHeight
  menuShift.value = placement.shiftX
}

// 选项换行、字体度量变化、窗口缩放都会改变菜单尺寸,所以两个元素都要盯住。
function observeMenu() {
  if (typeof ResizeObserver === 'undefined') return
  if (!resizeObserver) resizeObserver = new ResizeObserver(updatePlacement)
  resizeObserver.disconnect()
  if (listboxRef.value) resizeObserver.observe(listboxRef.value)
  if (triggerRef.value) resizeObserver.observe(triggerRef.value)
}

const options = computed(() => props.options ?? [])
const defaultOption = computed(() => options.value.find(option => option.value === props.defaultModel) ?? null)
const recommendedOptions = computed(() => options.value.filter(option => option.value !== props.defaultModel))
const selectedOption = computed(() => options.value.find(option => option.value === props.modelValue) ?? null)
const selectedLabel = computed(() => selectedOption.value?.label || defaultOption.value?.label || t('imagio.modelSelect'))

// 默认项排在第一组、推荐模型集跟在后面,所以键盘高亮需要一个横跨两组的扁平下标。
const recommendedOffset = computed(() => (defaultOption.value ? 1 : 0))
const optionList = computed(() => (defaultOption.value
  ? [defaultOption.value, ...recommendedOptions.value]
  : [...recommendedOptions.value]))
const selectedIndex = computed(() => optionList.value.findIndex(option => option.value === props.modelValue))
const activeDescendant = computed(() => (open.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined))

function optionId(index: number) {
  return `${baseId}-option-${index}`
}

function setActiveIndex(index: number) {
  activeIndex.value = index
  void nextTick(() => {
    const element = listboxRef.value?.querySelector<HTMLElement>('[data-active="true"]')
    // jsdom 没有实现 scrollIntoView,测试里挪动高亮时不该炸。
    if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
  })
}

function openMenu(position: 'selected' | 'first' | 'last' = 'selected') {
  if (props.disabled || !optionList.value.length) return
  open.value = true
  if (position === 'first') activeIndex.value = 0
  else if (position === 'last') activeIndex.value = optionList.value.length - 1
  else activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0
  // 焦点停在列表本身而不是逐个选项上,当前项由 aria-activedescendant 播报。
  void nextTick(() => {
    listboxRef.value?.focus()
    // 菜单此刻才有真实尺寸,量完再决定朝哪边弹、能有多高。
    updatePlacement()
    observeMenu()
  })
}

function closeMenu(restoreFocus = false) {
  if (!open.value) return
  open.value = false
  activeIndex.value = -1
  if (restoreFocus) triggerRef.value?.focus()
}

function toggleMenu() {
  if (open.value) closeMenu()
  else openMenu('selected')
}

function selectModel(value: string) {
  emit('update:modelValue', value)
  closeMenu(true)
}

function moveActive(key: string) {
  const total = optionList.value.length
  if (!total) return
  let next = activeIndex.value
  if (key === 'ArrowDown') next = next < 0 ? 0 : (next + 1) % total
  else if (key === 'ArrowUp') next = next <= 0 ? total - 1 : next - 1
  else if (key === 'Home') next = 0
  else if (key === 'End') next = total - 1
  setActiveIndex(next)
}

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])

function handleKeydown(event: KeyboardEvent) {
  const key = event.key

  if (key === 'Escape') {
    if (open.value) {
      event.preventDefault()
      closeMenu(true)
    }
    return
  }

  if (key === 'Tab') {
    if (open.value) {
      // 此刻焦点在列表上,放行 Tab 会把它直接丢给 body。
      event.preventDefault()
      closeMenu(true)
    }
    return
  }

  if (props.disabled || !optionList.value.length) return

  if (!open.value) {
    // Enter / Space 交给按钮原生的 click,这里不抢。
    if (key === 'ArrowDown') {
      event.preventDefault()
      openMenu('first')
    } else if (key === 'ArrowUp') {
      event.preventDefault()
      openMenu('last')
    }
    return
  }

  if (NAVIGATION_KEYS.has(key)) {
    event.preventDefault()
    moveActive(key)
    return
  }

  if (key === 'Enter' || key === ' ') {
    const option = optionList.value[activeIndex.value]
    if (option) {
      event.preventDefault()
      selectModel(option.value)
    }
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) closeMenu()
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
  window.addEventListener('resize', updatePlacement)
  // 捕获阶段:菜单所在的滚动容器未必是 window,祖先滚动同样要重算。
  window.addEventListener('scroll', updatePlacement, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
  window.removeEventListener('resize', updatePlacement)
  window.removeEventListener('scroll', updatePlacement, true)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div ref="rootRef" class="relative min-w-0" @keydown="handleKeydown">
    <button
      ref="triggerRef"
      type="button"
      class="image-model-trigger"
      :disabled="disabled || !options.length"
      :aria-expanded="open"
      :aria-controls="open ? listboxId : undefined"
      :title="selectedLabel"
      aria-haspopup="listbox"
      @click="toggleMenu"
    >
      <span class="min-w-0 truncate">{{ selectedLabel }}</span>
      <ChevronDown class="image-model-chevron h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
    </button>

    <div
      v-if="open && options.length"
      :id="listboxId"
      ref="listboxRef"
      class="image-model-menu"
      role="listbox"
      :data-side="placementSide"
      :style="menuStyle"
      :aria-labelledby="titleId"
      :aria-activedescendant="activeDescendant"
      tabindex="-1"
    >
      <div :id="titleId" class="image-model-menu-title">{{ t('imagio.modelSelect') }}</div>

      <div
        v-if="defaultOption"
        class="image-model-group"
        role="group"
        :aria-labelledby="defaultGroupLabelId"
      >
        <div :id="defaultGroupLabelId" class="image-model-group-label">{{ t('imagio.modelGroupDefault') }}</div>
        <button
          :id="optionId(0)"
          type="button"
          role="option"
          class="image-model-option"
          :data-active="activeIndex === 0 ? 'true' : undefined"
          :aria-selected="defaultOption.value === modelValue"
          :title="defaultOption.label"
          @click="selectModel(defaultOption.value)"
          @pointerenter="setActiveIndex(0)"
        >
          <span class="truncate">{{ defaultOption.label }}</span>
          <Check
            class="image-model-option-check h-4 w-4 shrink-0"
            :class="{ 'is-selected': defaultOption.value === modelValue }"
            aria-hidden="true"
          />
        </button>
      </div>

      <div
        v-if="recommendedOptions.length"
        class="image-model-group"
        role="group"
        :aria-labelledby="recommendedGroupLabelId"
      >
        <div :id="recommendedGroupLabelId" class="image-model-group-label">{{ t('imagio.modelGroupRecommended') }}</div>
        <button
          v-for="(option, index) in recommendedOptions"
          :id="optionId(recommendedOffset + index)"
          :key="option.value"
          type="button"
          role="option"
          class="image-model-option"
          :data-active="activeIndex === recommendedOffset + index ? 'true' : undefined"
          :aria-selected="option.value === modelValue"
          :title="option.label"
          @click="selectModel(option.value)"
          @pointerenter="setActiveIndex(recommendedOffset + index)"
        >
          <span class="truncate">{{ option.label }}</span>
          <Check
            class="image-model-option-check h-4 w-4 shrink-0"
            :class="{ 'is-selected': option.value === modelValue }"
            aria-hidden="true"
          />
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
  padding: 0 10px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md, 8px);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-codex, 180ms) var(--ease-codex, ease-out),
    border-color var(--dur-codex, 180ms) var(--ease-codex, ease-out);
}

.image-model-trigger:hover:not(:disabled),
.image-model-trigger[aria-expanded='true'] {
  border-color: hsl(var(--ring) / 0.28);
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

.image-model-chevron {
  transition: transform var(--dur-codex, 180ms) var(--ease-codex, ease-out);
}

.image-model-trigger[aria-expanded='true'] .image-model-chevron {
  transform: rotate(180deg);
}

.image-model-menu {
  position: absolute;
  right: 0;
  z-index: 50;
  width: min(max(100%, 300px), calc(100vw - 24px));
  max-height: var(--image-model-menu-max-height, 360px);
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-xl, 14px);
  background: hsl(var(--popover));
  box-shadow: 0 18px 60px hsl(var(--foreground) / 0.14);
  scrollbar-color: hsl(var(--muted-foreground) / 0.22) transparent;
  scrollbar-width: thin;
  /* 水平夹取挂在 translate 上,把 transform 完整留给入场动画——两者会互相覆盖。 */
  translate: var(--image-model-menu-shift, 0px) 0;
  animation: image-model-menu-in 160ms var(--ease-codex, ease-out) both;
}

/* 上方够就向上弹(贴着输入框),不够再翻到下方;8px 与 placeMenu 的 MENU_GAP 一致。 */
.image-model-menu[data-side='up'] {
  bottom: calc(100% + 8px);
  transform-origin: bottom right;
}

.image-model-menu[data-side='down'] {
  top: calc(100% + 8px);
  transform-origin: top right;
}

.image-model-menu:focus {
  outline: none;
}

@keyframes image-model-menu-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.image-model-menu-title {
  padding: 2px 10px 6px;
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 500;
}

.image-model-group + .image-model-group {
  margin-top: 4px;
}

.image-model-group-label {
  padding: 6px 10px 2px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
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
  border-radius: var(--radius-md, 8px);
  background: transparent;
  color: hsl(var(--foreground));
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms var(--ease-codex, ease-out);
}

.image-model-option:hover,
.image-model-option[data-active='true'],
.image-model-option[aria-selected='true'] {
  background: hsl(var(--muted));
}

/* 未选中项也留着同尺寸的对勾占位,选中时文字才不会左右跳动。 */
.image-model-option-check {
  opacity: 0;
  transition: opacity var(--dur-codex, 180ms) var(--ease-codex, ease-out);
}

.image-model-option-check.is-selected {
  opacity: 1;
}

/* 窄屏不再靠断点挪位置:placeMenu 已按视口边距夹取。 */
@media (prefers-reduced-motion: reduce) {
  .image-model-menu {
    animation: none;
  }

  .image-model-trigger,
  .image-model-chevron,
  .image-model-option,
  .image-model-option-check {
    transition: none;
  }
}
</style>
