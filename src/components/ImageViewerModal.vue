<script setup lang="ts">
import { ZoomOut, ZoomIn, Download, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import type { ImageViewerState } from '../lib/image-canvas-model'

defineProps<{
  viewer: ImageViewerState
  isDownloading: boolean
}>()

const emit = defineEmits<{
  close: []
  zoom: [step: number]
  'reset-zoom': []
  'preload-download': []
  download: []
}>()

function handleWheel(event: WheelEvent) {
  emit('zoom', event.deltaY > 0 ? -0.12 : 0.12)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[120] grid place-items-center p-6 bg-[rgba(10,15,25,0.78)] backdrop-blur-[10px] max-md:p-2.5"
      @pointerdown.self="emit('close')"
    >
      <div
        class="grid grid-rows-[auto_1fr] w-[min(1120px,calc(100vw-48px))] max-w-full h-[min(88vh,920px)] border border-white/16 rounded-xl bg-[rgba(10,15,25,0.96)] shadow-[0_28px_90px_rgba(0,0,0,0.38)] overflow-hidden max-md:w-[calc(100vw-20px)] max-md:h-[min(88vh,calc(100dvh-20px))]"
        @pointerdown.stop
      >
        <header
          class="flex items-center justify-between gap-4 min-h-[58px] px-[18px] py-0 border-b border-white/10 text-white max-md:items-start max-md:flex-col max-md:gap-2.5 max-md:min-h-0 max-md:p-3"
        >
          <div class="grid gap-1 min-w-0">
            <strong class="overflow-hidden text-sm font-black text-ellipsis whitespace-nowrap">
              {{ viewer.title }}
            </strong>
            <span class="overflow-hidden text-xs text-[rgba(226,232,240,0.78)] text-ellipsis whitespace-nowrap">
              {{ viewer.caption }}
              <small v-if="viewer.loadingPreview" class="ml-2 text-[rgba(255,255,255,0.58)] text-[11px] font-extrabold">
                正在加载预览图...
              </small>
            </span>
          </div>
          <div class="inline-flex items-center gap-2 max-md:w-full max-md:flex-wrap">
            <Button
              variant="ghost"
              size="icon"
              class="min-w-[34px] h-[34px] border border-white/16 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.16] max-md:min-w-11 max-md:h-11"
              title="缩小"
              @click="emit('zoom', -0.12)"
            >
              <ZoomOut class="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              class="min-w-[34px] h-[34px] border border-white/16 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.16] text-xs max-md:min-w-11 max-md:h-11"
              title="复位"
              @click="emit('reset-zoom')"
            >
              1:1
            </Button>
            <span
              class="inline-flex items-center justify-center min-w-[62px] h-[34px] px-2.5 rounded-lg bg-white/[0.08] text-[rgba(255,255,255,0.88)] text-xs font-extrabold max-md:min-w-11 max-md:h-11"
            >
              {{ Math.round((viewer.zoom || 1) * 100) }}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              class="min-w-[34px] h-[34px] border border-white/16 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.16] max-md:min-w-11 max-md:h-11"
              title="放大"
              @click="emit('zoom', 0.12)"
            >
              <ZoomIn class="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="min-w-[34px] h-[34px] border border-white/16 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.16] disabled:opacity-[0.46] disabled:cursor-not-allowed max-md:min-w-11 max-md:h-11"
              title="下载"
              :disabled="isDownloading"
              @pointerenter="emit('preload-download')"
              @focus="emit('preload-download')"
              @click="emit('download')"
            >
              <Download class="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="min-w-[34px] h-[34px] border border-white/16 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.16] max-md:min-w-11 max-md:h-11"
              title="关闭"
              @click="emit('close')"
            >
              <X class="w-4 h-4" />
            </Button>
          </div>
        </header>
        <div
          class="grid place-items-center min-h-0 overflow-auto p-6 max-md:p-3"
          @wheel.prevent="handleWheel"
        >
          <img
            :src="viewer.imageUrl"
            :alt="viewer.caption"
            :style="{
              width: `${Math.round(viewer.zoom * 100)}%`,
              height: `${Math.round(viewer.zoom * 100)}%`,
            }"
            draggable="false"
            class="min-w-0 min-h-0 object-contain select-none"
          >
        </div>
      </div>
    </div>
  </Teleport>
</template>
