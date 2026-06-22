<script setup lang="ts">
import { type HTMLAttributes, ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  open?: boolean
  side?: 'left' | 'right'
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  side: 'left',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const isOpen = computed(() => props.open)

function close() {
  emit('update:open', false)
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

watch(isOpen, (val) => {
  if (val) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition :name="side === 'left' ? 'sheet-left' : 'sheet-right'">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50"
        @click="onOverlayClick"
      >
        <!-- Overlay -->
        <div class="fixed inset-0 bg-black/40 backdrop-blur-sm" />

        <!-- Panel -->
        <div
          :class="cn(
            'fixed top-0 bottom-0 z-50 flex w-[300px] flex-col border-border bg-background p-0 shadow-lg',
            side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
            props.class
          )"
          role="dialog"
          aria-modal="true"
        >
          <slot :close="close" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-left-enter-active,
.sheet-left-leave-active,
.sheet-right-enter-active,
.sheet-right-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-left-enter-active > div:last-child,
.sheet-left-leave-active > div:last-child {
  transition: transform 0.2s ease;
}
.sheet-right-enter-active > div:last-child,
.sheet-right-leave-active > div:last-child {
  transition: transform 0.2s ease;
}
.sheet-left-enter-from,
.sheet-left-leave-to,
.sheet-right-enter-from,
.sheet-right-leave-to {
  opacity: 0;
}
.sheet-left-enter-from > div:last-child {
  transform: translateX(-100%);
}
.sheet-left-leave-to > div:last-child {
  transform: translateX(-100%);
}
.sheet-right-enter-from > div:last-child {
  transform: translateX(100%);
}
.sheet-right-leave-to > div:last-child {
  transform: translateX(100%);
}
</style>
