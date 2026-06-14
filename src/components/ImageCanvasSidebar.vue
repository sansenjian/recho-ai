<script setup lang="ts">
import { MINI_MAP_VIEW, type CanvasNodeType, type WorkspaceMode } from '../lib/image-canvas-model'
import { displayImageUrl } from '../lib/image-gallery'
import type { GeneratedImage } from '../types/image'

type MiniMapLayout = {
  connections: Array<{
    id: string
    d: string
  }>
  nodes: Array<{
    id: string
    type: CanvasNodeType
    selected: boolean
    x: number
    y: number
    width: number
    height: number
  }>
  viewport: {
    x: number
    y: number
    width: number
    height: number
  } | null
}

defineProps<{
  activeWorkspace: WorkspaceMode
  imageMode?: 'imagio' | 'canvas'
  miniMapLayout: MiniMapLayout
  historyImages: GeneratedImage[]
  hasGeneratedImages: boolean
}>()

const emit = defineEmits<{
  'select-workspace': [mode: WorkspaceMode]
  'select-image-mode': [mode: 'imagio' | 'canvas']
  'create-node': [type: CanvasNodeType]
  'use-history-image': [image: GeneratedImage]
  'clear-history': []
}>()
</script>

<template>
  <aside class="canvas-sidebar">
    <div class="workspace-switch">
      <button
        class="workspace-tab"
        type="button"
        :class="{ active: activeWorkspace === 'canvas' }"
        @click="emit('select-workspace', 'canvas')"
      >
        工作台
      </button>
      <button
        class="workspace-tab"
        type="button"
        :class="{ active: activeWorkspace === 'gallery' }"
        @click="emit('select-workspace', 'gallery')"
      >
        作品广场
      </button>
    </div>

    <div class="mode-switch">
      <button
        type="button"
        :class="{ active: imageMode === 'imagio' }"
        @click="emit('select-image-mode', 'imagio')"
      >
        Imagio
      </button>
      <button
        type="button"
        :class="{ active: imageMode === 'canvas' }"
        @click="emit('select-image-mode', 'canvas')"
      >
        画布
      </button>
    </div>

    <div class="mini-map" aria-hidden="true">
      <div class="mini-map-frame">
        <svg
          class="mini-map-svg"
          :viewBox="`0 0 ${MINI_MAP_VIEW.width} ${MINI_MAP_VIEW.height}`"
          preserveAspectRatio="none"
        >
          <path
            v-for="connection in miniMapLayout.connections"
            :key="connection.id"
            class="mini-connection"
            :d="connection.d"
          />
          <rect
            v-for="node in miniMapLayout.nodes"
            :key="node.id"
            class="mini-node"
            :class="[`mini-node-${node.type}`, { selected: node.selected }]"
            :x="node.x"
            :y="node.y"
            :width="node.width"
            :height="node.height"
            rx="1.6"
          />
          <rect
            v-if="miniMapLayout.viewport"
            class="mini-viewport"
            :x="miniMapLayout.viewport.x"
            :y="miniMapLayout.viewport.y"
            :width="miniMapLayout.viewport.width"
            :height="miniMapLayout.viewport.height"
            rx="2"
          />
        </svg>
      </div>
    </div>

    <div class="quick-create">
      <button class="create-button" type="button" title="创建文本节点" @click="emit('create-node', 'text')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
          <path d="M4 6h16" />
          <path d="M10 6v12" />
          <path d="M14 6v12" />
        </svg>
      </button>
      <button class="create-button" type="button" title="创建图片节点" @click="emit('create-node', 'image')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </button>
      <button class="create-button primary" type="button" title="创建生图节点" @click="emit('create-node', 'generation')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
          <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
        </svg>
      </button>
    </div>

    <div class="history-panel">
      <div class="side-title">
        <span>生成记录</span>
        <button v-if="hasGeneratedImages" type="button" disabled @click="emit('clear-history')">清空</button>
      </div>
      <button
        v-for="image in historyImages"
        :key="image.id"
        class="history-item"
        type="button"
        @click="emit('use-history-image', image)"
      >
        <img :src="displayImageUrl(image)" :alt="image.prompt" loading="lazy">
        <span>{{ image.prompt || image.size }}</span>
      </button>
      <div v-if="!historyImages.length" class="history-empty">暂无记录</div>
    </div>
  </aside>
</template>

<style scoped>
.canvas-sidebar {
  width: 286px;
  flex-shrink: 0;
  padding: 14px 12px;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, #f9fafb 0%, #ffffff 100%);
  overflow-y: auto;
}

.workspace-switch {
  display: inline-flex;
  gap: 6px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  box-shadow: var(--shadow-sm);
}

.workspace-tab {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.workspace-tab.active {
  background: #0b0f14;
  color: #fff;
}

.mode-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 4px 42px;
  padding: 4px;
  border-radius: 12px;
  background: #eef1f4;
  font-size: 15px;
  font-weight: 800;
}

.mode-switch button {
  flex: 1;
  min-height: 38px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #73777f;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-switch button.active {
  background: #fff;
  color: #0f172a;
  box-shadow: var(--shadow-sm);
}

.mini-map {
  height: 156px;
  padding: 10px;
  border: 1px solid #1f2937;
  border-radius: 8px;
  background:
    linear-gradient(#edf2f7 1px, transparent 1px),
    linear-gradient(90deg, #edf2f7 1px, transparent 1px),
    #fff;
  background-size: 18px 18px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08);
}

.mini-map-frame {
  position: relative;
  height: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
}

.mini-map-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.mini-connection {
  fill: none;
  stroke: #94a3b8;
  stroke-width: 0.7;
  stroke-linecap: round;
}

.mini-node {
  fill: #fff;
  stroke: #cbd5e1;
  stroke-width: 0.55;
}

.mini-node-text {
  fill: #f8fafc;
}

.mini-node-image {
  fill: #eef6ff;
}

.mini-node-generation {
  fill: #fff7ed;
}

.mini-node.selected {
  stroke: #111827;
  stroke-width: 0.9;
}

.mini-viewport {
  fill: rgba(37, 99, 235, 0.08);
  stroke: #111827;
  stroke-width: 0.9;
  stroke-dasharray: 3 2;
  pointer-events: none;
}

.quick-create {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 34px 0 28px;
}

.create-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.create-button:hover {
  border-color: var(--border);
  background: var(--hover-bg);
  color: var(--text-primary);
}

.create-button.primary {
  background: #111827;
  color: #fff;
}

.history-panel {
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
}

.side-title button {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.side-title button:disabled {
  opacity: 0.42;
  cursor: default;
}

.history-item {
  display: grid;
  grid-template-columns: 38px 1fr;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 8px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}

.history-item:hover {
  border-color: var(--border-strong);
  background: var(--surface-soft);
}

.history-item img {
  width: 38px;
  height: 38px;
  border-radius: 6px;
  object-fit: cover;
}

.history-item span {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-empty {
  padding: 18px 0;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

@media (max-width: 980px) {
  .canvas-sidebar {
    width: 220px;
  }
}

@media (max-width: 760px) {
  .canvas-sidebar {
    display: none;
  }
}
</style>
