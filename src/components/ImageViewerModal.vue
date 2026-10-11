<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ZoomOut, ZoomIn, Download, X, ChevronLeft, ChevronRight, RotateCcw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import type { ImageViewerState } from '../lib/image-canvas-model'
import AuthenticatedImage from './AuthenticatedImage.vue'

const props = defineProps<{
  viewer: ImageViewerState
  isDownloading: boolean
  /** 同批图片总数与当前位置，用于左右切换；单张时为 1 / 0。 */
  total: number
  index: number
}>()

const emit = defineEmits<{
  close: []
  zoom: [step: number]
  'reset-zoom': []
  'preload-download': []
  download: []
  previous: []
  next: []
}>()

function handleWheel(event: WheelEvent) {
  emit('zoom', event.deltaY > 0 ? -0.12 : 0.12)
}

/**
 * 拖拽平移。
 *
 * 放大后图片超出视野，没有平移就只能靠滚动条挪，看边角很别扭。偏移量留在
 * 组件本地：它是纯视图状态，父组件不需要知道。
 */
const panning = ref(false)
const panOffset = ref({ x: 0, y: 0 })
let panStart = { x: 0, y: 0, ox: 0, oy: 0 }

function startPan(event: PointerEvent) {
  // 只响应左键，避免和右键菜单、触控板手势打架。
  if (event.button !== 0) return
  panning.value = true
  panStart = { x: event.clientX, y: event.clientY, ox: panOffset.value.x, oy: panOffset.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function movePan(event: PointerEvent) {
  if (!panning.value) return
  panOffset.value = {
    x: panStart.ox + (event.clientX - panStart.x),
    y: panStart.oy + (event.clientY - panStart.y),
  }
}

function endPan(event: PointerEvent) {
  if (!panning.value) return
  panning.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

/**
 * 换图时回到居中，否则上一张的偏移会套到新图上，让人以为图片跑丢了。
 *
 * 缩放时刻意不重置：连续放大同一张图时把视线拽回中心很烦人，用户看到的图会
 * 突然跳一下。只有换图才需要归位。
 */
function resetPan() {
  panOffset.value = { x: 0, y: 0 }
}

watch(() => [props.viewer.storagePath, props.viewer.previewPath, props.index], resetPan)

/**
 * 键盘操作。
 *
 * 看图时手在键盘上：Esc 关不掉、方向键翻不动就只能伸鼠标去找小按钮。
 * 方向键用于翻页（与系统看图工具一致），缩放交给 +/-。
 */
function handleKeydown(event: KeyboardEvent) {
  // 带修饰键的是浏览器自己的快捷键（Ctrl/Cmd +、-、0 会缩放整个页面），
  // 拦下来会把页面缩放变成图片缩放，用户会以为浏览器坏了。
  if (event.ctrlKey || event.metaKey || event.altKey) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      emit('close')
      break
    case 'ArrowLeft':
      if (props.total > 1) { event.preventDefault(); emit('previous') }
      break
    case 'ArrowRight':
      if (props.total > 1) { event.preventDefault(); emit('next') }
      break
    case '+':
    case '=':
      event.preventDefault()
      emit('zoom', 0.12)
      break
    case '-':
      event.preventDefault()
      emit('zoom', -0.12)
      break
    case '0':
      event.preventDefault()
      emit('reset-zoom')
      break
  }
}


/** 操作条，用于打开时把焦点移进来。 */
const actionsRef = ref<HTMLElement | null>(null)
/** 打开查看器前焦点所在的位置，关闭时要还回去。 */
let previouslyFocused: HTMLElement | null = null

/**
 * 焦点管理。
 *
 * 没有它，从缩略图打开后焦点还留在页面原按钮上：按 Tab 会走到遮罩后面的控件，
 * 而不是查看器里的按钮。Teleport 只搬 DOM，不会替组件做这件事。
 */
function focusFirstAction() {
  const first = actionsRef.value?.querySelector<HTMLElement>('button')
  first?.focus()
}

/** 把 Tab 限制在操作条内，避免焦点跑到遮罩背后。 */
function trapTab(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const buttons = [...(actionsRef.value?.querySelectorAll<HTMLElement>('button') ?? [])]
    .filter(button => !button.hasAttribute('disabled'))
  if (!buttons.length) return
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  previouslyFocused = document.activeElement as HTMLElement | null
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('keydown', trapTab)
  // 等一帧，确保 Teleport 的内容已经挂上再聚焦。
  void nextTick(focusFirstAction)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('keydown', trapTab)
  // 焦点还给打开它的那个按钮，键盘用户可以接着往下走。
  previouslyFocused?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <!--
      无边框铺满遮罩：图片本身就是内容，再套一层卡片和标题栏只是多余的边框。
      操作排在图片正下方居中，视线不需要来回找。
    -->
    <!--
      role="dialog" + aria-modal：读屏会把它当作一个独立的对话框，
      而不是页面里多出来的一堆按钮。aria-label 用图片标题，打开时能报出在看哪张。
    -->
    <div
      class="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-[rgba(10,15,25,0.86)] backdrop-blur-[6px] p-6 max-md:p-3"
      role="dialog"
      aria-modal="true"
      :aria-label="viewer.title"
      @pointerdown.self="emit('close')"
    >
      <!--
        图片区：可拖拽平移，滚轮缩放。两侧翻页按钮只在多图时出现。

        缩放用 width/height 而不是 max-width/max-height：后者只限制上限，
        一张小于视口的图无论怎么调百分比都不会变大，放大操作看上去毫无反应。
      -->
      <div class="relative flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          class="grid h-full w-full place-items-center overflow-hidden"
          :class="panning ? 'cursor-grabbing' : 'cursor-grab'"
          @wheel.prevent="handleWheel"
          @pointerdown="startPan"
          @pointermove="movePan"
          @pointerup="endPan"
          @pointercancel="endPan"
        >
          <AuthenticatedImage
            :source="viewer"
            :src="viewer.imageUrl"
            mode="preview"
            :alt="viewer.caption"
            :style="{
              width: `${Math.round(viewer.zoom * 100)}%`,
              height: `${Math.round(viewer.zoom * 100)}%`,
              transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            }"
            draggable="false"
            class="min-w-0 min-h-0 object-contain select-none"
          />
        </div>

        <Button
          v-if="total > 1"
          variant="ghost"
          size="icon"
          class="absolute left-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20 max-md:hidden"
          title="上一张"
          aria-label="上一张"
          @click.stop="emit('previous')"
        >
          <ChevronLeft class="h-5 w-5" />
        </Button>
        <Button
          v-if="total > 1"
          variant="ghost"
          size="icon"
          class="absolute right-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20 max-md:hidden"
          title="下一张"
          aria-label="下一张"
          @click.stop="emit('next')"
        >
          <ChevronRight class="h-5 w-5" />
        </Button>
      </div>

      <!--
        操作条：贴在图片下方居中，样式与遮罩同色系，不构成额外的一层容器。
        点它自己的空白处不关闭，所以要阻止冒泡。
      -->
      <div
        ref="actionsRef"
        class="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-1.5 py-1 backdrop-blur"
        @pointerdown.stop
      >
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 rounded-full text-white hover:bg-white/15"
          title="缩小"
          aria-label="缩小"
          @click="emit('zoom', -0.12)"
        >
          <ZoomOut class="h-4 w-4" />
        </Button>
        <span class="min-w-[52px] text-center text-xs font-medium tabular-nums text-white/85">
          {{ Math.round((viewer.zoom || 1) * 100) }}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 rounded-full text-white hover:bg-white/15"
          title="放大"
          aria-label="放大"
          @click="emit('zoom', 0.12)"
        >
          <ZoomIn class="h-4 w-4" />
        </Button>
        <span class="mx-0.5 h-5 w-px bg-white/15" />
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 rounded-full text-white hover:bg-white/15"
          title="原始大小"
          aria-label="原始大小"
          @click="emit('reset-zoom')"
        >
          <RotateCcw class="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 rounded-full text-white hover:bg-white/15 disabled:opacity-40"
          title="下载"
          aria-label="下载"
          :disabled="isDownloading"
          @pointerenter="emit('preload-download')"
          @focus="emit('preload-download')"
          @click="emit('download')"
        >
          <Download class="h-4 w-4" />
        </Button>
        <span class="mx-0.5 h-5 w-px bg-white/15" />
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 rounded-full text-white hover:bg-white/15"
          title="关闭"
          aria-label="关闭"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </Button>
      </div>

      <!-- 多图时给一句位置提示；标题反而会抢走图片的注意力。 -->
      <p v-if="total > 1" class="shrink-0 text-xs tabular-nums text-white/55">
        {{ index + 1 }} / {{ total }}
      </p>
    </div>
  </Teleport>
</template>
