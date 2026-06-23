<script setup lang="ts">
import { type HTMLAttributes, ref, watch, onMounted, onUnmounted, computed } from 'vue'
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

function close() {
  emit('update:open', false)
}

function onOverlayClick() {
  close()
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
    <Transition name="dialog">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <!-- Overlay -->
        <div class="fixed inset-0 bg-black/40 backdrop-blur-sm" @click="onOverlayClick" />

        <!-- Content -->
        <div
          :class="cn(
            'relative z-50 w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-lg',
            'animate-in fade-in-0 zoom-in-95',
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
