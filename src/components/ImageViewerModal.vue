<script setup lang="ts">
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
    <div class="image-viewer-overlay" @pointerdown.self="emit('close')">
      <div class="image-viewer-shell" @pointerdown.stop>
        <header class="image-viewer-header">
          <div class="image-viewer-meta">
            <strong>{{ viewer.title }}</strong>
            <span>
              {{ viewer.caption }}
              <small v-if="viewer.loadingPreview">正在加载预览图...</small>
            </span>
          </div>
          <div class="image-viewer-controls">
            <button type="button" title="缩小" @click="emit('zoom', -0.12)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16">
                <circle cx="11" cy="11" r="7" />
                <path d="M8 11h6" />
                <path d="m16 16 4 4" />
              </svg>
            </button>
            <button type="button" title="复位" @click="emit('reset-zoom')">1:1</button>
            <span class="image-viewer-zoom">{{ Math.round((viewer.zoom || 1) * 100) }}%</span>
            <button type="button" title="放大" @click="emit('zoom', 0.12)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16">
                <circle cx="11" cy="11" r="7" />
                <path d="M8 11h6" />
                <path d="M11 8v6" />
                <path d="m16 16 4 4" />
              </svg>
            </button>
            <button
              type="button"
              title="下载"
              :disabled="isDownloading"
              @pointerenter="emit('preload-download')"
              @focus="emit('preload-download')"
              @click="emit('download')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 19h14" />
              </svg>
            </button>
            <button type="button" class="image-viewer-close" title="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </header>
        <div class="image-viewer-stage" @wheel.prevent="handleWheel">
          <img
            :src="viewer.imageUrl"
            :alt="viewer.caption"
            :style="{
              width: `${Math.round(viewer.zoom * 100)}%`,
              height: `${Math.round(viewer.zoom * 100)}%`,
            }"
            draggable="false"
          >
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.image-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(10, 15, 25, 0.78);
  backdrop-filter: blur(10px);
}

.image-viewer-shell {
  display: grid;
  grid-template-rows: auto 1fr;
  width: min(1120px, calc(100vw - 48px));
  max-width: 100%;
  height: min(88vh, 920px);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  background: rgba(10, 15, 25, 0.96);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.38);
  overflow: hidden;
}

.image-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
}

.image-viewer-meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.image-viewer-meta strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer-meta span {
  overflow: hidden;
  color: rgba(226, 232, 240, 0.78);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer-meta small {
  margin-left: 8px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 11px;
  font-weight: 800;
}

.image-viewer-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.image-viewer-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
}

.image-viewer-controls button:hover {
  background: rgba(255, 255, 255, 0.16);
}

.image-viewer-close {
  color: #fff;
}

.image-viewer-zoom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 62px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  font-weight: 800;
}

.image-viewer-stage {
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: auto;
  padding: 24px;
}

.image-viewer-stage img {
  min-width: 0;
  min-height: 0;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

@media (max-width: 768px) {
  .image-viewer-overlay {
    padding: 10px;
  }

  .image-viewer-shell {
    width: calc(100vw - 20px);
    height: min(88vh, calc(100dvh - 20px));
  }

  .image-viewer-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 12px;
  }

  .image-viewer-controls {
    width: 100%;
    flex-wrap: wrap;
  }

  .image-viewer-controls button {
    min-width: 44px;
    height: 44px;
  }

  .image-viewer-stage {
    padding: 12px;
  }
}
</style>
