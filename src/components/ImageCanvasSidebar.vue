<script setup lang="ts">
import { computed, ref } from 'vue'
import { MINI_MAP_VIEW, type CanvasNodeType, type WorkspaceMode } from '../lib/image-canvas-model'
import { displayImageUrl } from '../lib/image-gallery'
import type { GeneratedImage } from '../types/image'

interface Workspace {
  id: string
  name: string
}

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

const CANVAS_WORKSPACES_KEY = 'canvas-workspaces'
const CANVAS_ACTIVE_WORKSPACE_KEY = 'canvas-active-workspace'

const props = defineProps<{
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

// --- Mini workspace list (matches Imagio sidebar UX) ---
function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(CANVAS_WORKSPACES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch (err) {
    console.warn('[canvas-sidebar] failed to load workspaces from localStorage', err)
  }
  return [{ id: crypto.randomUUID(), name: '画布 1' }]
}

function loadActiveId(workspaces: Workspace[]): string {
  const stored = localStorage.getItem(CANVAS_ACTIVE_WORKSPACE_KEY)
  if (stored && workspaces.some(w => w.id === stored)) return stored
  return workspaces[0]?.id || ''
}

const workspaces = ref<Workspace[]>(loadWorkspaces())
const activeWorkspaceId = ref(loadActiveId(workspaces.value))

function persistWorkspaces() {
  localStorage.setItem(CANVAS_WORKSPACES_KEY, JSON.stringify(workspaces.value))
  localStorage.setItem(CANVAS_ACTIVE_WORKSPACE_KEY, activeWorkspaceId.value)
}

function addWorkspace() {
  const index = workspaces.value.length + 1
  const ws: Workspace = { id: crypto.randomUUID(), name: `画布 ${index}` }
  workspaces.value.push(ws)
  activeWorkspaceId.value = ws.id
  persistWorkspaces()
}

function selectWorkspace(id: string) {
  activeWorkspaceId.value = id
  persistWorkspaces()
}

const historyCountText = computed(() => `${props.historyImages.length} 个任务`)
</script>

<template>
  <aside class="canvas-sidebar">
    <!-- Mode switch: Imagio / 画布 -->
    <div class="mode-switch">
      <button
        type="button"
        :class="{ active: imageMode !== 'canvas' }"
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

    <!-- Workspace list -->
    <div class="sidebar-section workspace-section">
      <div class="section-header">
        <span>工作区</span>
        <button type="button" class="plus-btn" title="新建工作区" @click="addWorkspace">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>
      <div class="workspace-list">
        <button
          v-for="ws in workspaces"
          :key="ws.id"
          type="button"
          class="workspace-item"
          :class="{ active: ws.id === activeWorkspaceId }"
          @click="selectWorkspace(ws.id)"
        >
          <svg class="drag-handle" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
            <circle cx="9" cy="6" r="1.4" />
            <circle cx="15" cy="6" r="1.4" />
            <circle cx="9" cy="12" r="1.4" />
            <circle cx="15" cy="12" r="1.4" />
            <circle cx="9" cy="18" r="1.4" />
            <circle cx="15" cy="18" r="1.4" />
          </svg>
          <span class="ws-name">{{ ws.name }}</span>
        </button>
      </div>
    </div>

    <!-- Canvas-specific: mini-map + quick create -->
    <div class="sidebar-section canvas-section">
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </button>
        <button class="create-button primary" type="button" title="创建生图节点" @click="emit('create-node', 'generation')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
            <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
            <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- History section (unified style) -->
    <div class="sidebar-section history-section">
      <div class="section-header history-header">
        <span>历史记录</span>
        <span class="history-meta">
          <span class="history-count">{{ historyCountText }}</span>
          <button
            v-if="hasGeneratedImages"
            type="button"
            class="clear-btn"
            @click="emit('clear-history')"
          >
            清空历史
          </button>
        </span>
      </div>
      <div v-if="historyImages.length" class="history-list">
        <button
          v-for="image in historyImages"
          :key="image.id"
          type="button"
          class="history-task"
          @click="emit('use-history-image', image)"
        >
          <img
            v-if="displayImageUrl(image)"
            :src="displayImageUrl(image)"
            :alt="image.prompt"
            loading="lazy"
            class="task-thumb"
          >
          <div v-else class="task-thumb-placeholder" />
          <div class="task-info">
            <span class="task-title">{{ image.prompt || image.size }}</span>
            <span class="task-status">
              <span class="status-dot" />
              完成 · 1/1
            </span>
          </div>
        </button>
      </div>
      <div v-else class="history-empty">暂无记录</div>
    </div>
  </aside>
</template>

<style scoped>
/* ============ Container (unified with ImagioSidebar) ============ */
.canvas-sidebar {
  width: 286px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, #f9fafb 0%, #ffffff 100%);
  overflow: hidden;
}

/* ============ Mode switch (unified) ============ */
.mode-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 14px 18px;
  padding: 4px;
  border-radius: 10px;
  background: #eef1f4;
  font-size: 14px;
  font-weight: 800;
}

.mode-switch button {
  flex: 1;
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  font-family: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.mode-switch button.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

/* ============ Section common (unified) ============ */
.sidebar-section {
  padding: 0 14px 14px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
}

.plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.plus-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

/* ============ Workspace section (unified with Imagio) ============ */
.workspace-section {
  border-bottom: 1px solid var(--border);
  padding-bottom: 18px;
  margin-bottom: 4px;
}

.workspace-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.workspace-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.workspace-item:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.workspace-item.active {
  background: #f0f2f5;
  color: var(--text-primary);
}

.drag-handle {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.55;
}

.ws-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============ Canvas-specific: mini-map + quick create ============ */
.canvas-section {
  border-bottom: 1px solid var(--border);
  padding-bottom: 18px;
  margin-bottom: 4px;
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
  margin-top: 14px;
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
  transition: all 0.15s;
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

/* ============ History section (unified with Imagio) ============ */
.history-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 12px;
}

.history-header .history-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-count {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.clear-btn {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.15s;
}

.clear-btn:hover {
  color: var(--text-primary);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-task {
  display: grid;
  grid-template-columns: 44px 1fr;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.history-task:hover {
  background: var(--hover-bg);
}

.task-thumb {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.task-thumb-placeholder {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: #eef1f4;
}

.task-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.task-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-status {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
}

.history-empty {
  padding: 24px 0;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

/* ============ Responsive (unified) ============ */
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
