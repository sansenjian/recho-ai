<script setup lang="ts">
import { ref } from 'vue'
import type { CanvasNodeType } from '../lib/image-canvas-model'

type CanvasImportMode = 'append' | 'replace'

defineProps<{
  zoomLabel: string
}>()

const emit = defineEmits<{
  'create-node': [type: CanvasNodeType]
  'fit-view': []
  'import-canvas': [event: Event, mode: CanvasImportMode]
  'export-canvas': []
  'clear-canvas': []
}>()

const canvasImportInputRef = ref<HTMLInputElement | null>(null)
let pendingCanvasImportMode: CanvasImportMode = 'append'

function openCanvasImportPicker(event: MouseEvent) {
  pendingCanvasImportMode = event.shiftKey ? 'replace' : 'append'
  if (canvasImportInputRef.value) {
    canvasImportInputRef.value.value = ''
    canvasImportInputRef.value.click()
  }
}

function handleCanvasImport(event: Event) {
  emit('import-canvas', event, pendingCanvasImportMode)
}
</script>

<template>
  <div class="stage-actions">
    <div class="mobile-create-bar" aria-label="创建节点">
      <button type="button" @click="emit('create-node', 'text')">
        <span class="mobile-create-icon">T</span>
        <span>文本</span>
      </button>
      <button type="button" @click="emit('create-node', 'image')">
        <span class="mobile-create-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </span>
        <span>图片</span>
      </button>
      <button class="primary" type="button" @click="emit('create-node', 'generation')">
        <span class="mobile-create-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
          </svg>
        </span>
        <span>生图</span>
      </button>
    </div>

    <button class="tool-button" type="button" title="复位视图" @click="emit('fit-view')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v6h6" />
      </svg>
    </button>

    <input
      ref="canvasImportInputRef"
      class="canvas-file-input"
      type="file"
      accept="application/json,.json"
      @change="handleCanvasImport"
    >

    <button
      class="tool-button"
      type="button"
      title="导入画布 JSON，默认追加；按住 Shift 替换"
      @click="openCanvasImportPicker"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 15v4h14v-4" />
      </svg>
    </button>

    <button class="tool-button" type="button" title="导出画布 JSON" @click="emit('export-canvas')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="M12 21V9" />
        <path d="m7 16 5 5 5-5" />
        <path d="M5 5h14v4" />
      </svg>
    </button>

    <button class="tool-button danger" type="button" title="清空画布" @click="emit('clear-canvas')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="m6 6 1 15h10l1-15" />
      </svg>
    </button>

    <span class="zoom-pill">{{ zoomLabel }}</span>
  </div>
</template>

<style scoped>
.stage-actions {
  position: absolute;
  right: 18px;
  top: 18px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(12px);
}

.mobile-create-bar {
  display: none;
}

.tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tool-button:hover {
  border-color: var(--border);
  background: var(--hover-bg);
  color: var(--text-primary);
}

.tool-button.danger:hover {
  color: var(--danger);
}

.canvas-file-input {
  display: none;
}

.zoom-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 24px;
  padding: 0 7px;
  border-radius: 999px;
  background: #111827;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

@media (max-width: 760px) {
  .stage-actions {
    left: 10px;
    right: auto;
    top: 10px;
    width: max-content;
    max-width: calc(100% - 20px);
    overflow-x: auto;
    flex-wrap: nowrap;
    justify-content: flex-start;
    padding: 6px;
    scrollbar-width: thin;
  }

  .mobile-create-bar {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    min-width: 0;
  }

  .mobile-create-bar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 68px;
    min-height: 40px;
    padding: 0 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 900;
    white-space: nowrap;
  }

  .mobile-create-bar button.primary {
    min-width: 76px;
    border-color: #111827;
    background: #111827;
    color: #fff;
  }

  .mobile-create-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    font-weight: 900;
  }

  .tool-button {
    width: 44px;
    height: 44px;
  }

  .zoom-pill {
    min-width: 44px;
    height: 44px;
    padding: 0 8px;
  }
}
</style>
