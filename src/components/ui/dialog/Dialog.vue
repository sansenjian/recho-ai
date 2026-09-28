<script setup lang="ts">
import { type HTMLAttributes, ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  open?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const isOpen = computed(() => props.open)
const contentRef = ref<HTMLElement | null>(null)
/** 打开前的焦点元素，关闭后要还回去；否则键盘用户会丢失当前位置。 */
let restoreFocusTo: HTMLElement | null = null

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 只在弹窗内部循环焦点：首尾互跳，避免 Tab 跑到遮罩层后面。 */
function onTabKeydown(event: KeyboardEvent) {
  const content = contentRef.value
  if (!content) return
  // jsdom 没有布局引擎，offsetParent 恒为 null；只在有布局信息时用它排除隐藏元素。
  const candidates = Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE))
  const laidOut = candidates.filter(element => element.offsetParent !== null)
  const focusable = laidOut.length ? laidOut : candidates
  if (!focusable.length) {
    event.preventDefault()
    content.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inside = active ? content.contains(active) : false

  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault()
      last.focus()
    }
    return
  }
  if (!inside || active === last) {
    event.preventDefault()
    first.focus()
  }
}

function close() {
  emit('update:open', false)
}

function onOverlayClick() {
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key === 'Tab') onTabKeydown(e)
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

// immediate: true —— 组件以 open=true 挂载时（v-if 重挂载等场景）也要完成聚焦与滚动锁定。
watch(isOpen, async (val) => {
  if (val) {
    document.body.style.overflow = 'hidden'
    // 记住触发控件，关闭后把焦点还回去。
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    const content = contentRef.value
    if (!content) return
    // 优先聚焦内容区内的第一个可聚焦元素，否则聚焦容器本身。
    const focusable = content.querySelector<HTMLElement>(FOCUSABLE)
    if (focusable) {
      focusable.focus()
      return
    }
    content.focus()
  } else {
    document.body.style.overflow = ''
    if (restoreFocusTo?.isConnected) restoreFocusTo.focus()
    restoreFocusTo = null
  }
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <!-- Overlay -->
        <div class="fixed inset-0 bg-black/40 backdrop-blur-sm" @click="onOverlayClick" />

        <!-- Content -->
        <div
          ref="contentRef"
          :class="cn(
            'relative z-50 w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-lg outline-none',
            'animate-in fade-in-0 zoom-in-95',
            props.class
          )"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
        >
          <slot :close="close" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.15s ease;
}
.dialog-enter-active > div:last-child,
.dialog-leave-active > div:last-child {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from > div:last-child {
  transform: scale(0.95);
  opacity: 0;
}
.dialog-leave-to > div:last-child {
  transform: scale(0.95);
  opacity: 0;
}
</style>
