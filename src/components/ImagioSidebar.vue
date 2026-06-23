<script setup lang="ts">
import { computed, ref } from 'vue'
import { displayImageUrl } from '../lib/image-gallery'
import { useCredits } from '../composables/useCredits'
import { useAuthSession } from '../composables/useAuthSession'
import type { GeneratedImage } from '../types/image'

interface Workspace {
  id: string
  name: string
}

const WORKSPACES_STORAGE_KEY = 'imagio-workspaces'
const ACTIVE_WORKSPACE_KEY = 'imagio-active-workspace'

const props = defineProps<{
  imageMode?: 'imagio' | 'canvas'
  historyImages: GeneratedImage[]
  hasGeneratedImages: boolean
  isLoadingHistory?: boolean
}>()

const emit = defineEmits<{
  'select-image-mode': [mode: 'imagio' | 'canvas']
  'select-workspace-tab': [tab: 'canvas' | 'gallery']
  'use-history-image': [image: GeneratedImage]
  'clear-history': []
}>()

const { creditBalance, refreshCredits } = useCredits()
const { user } = useAuthSession()

const userName = computed(() => {
  const meta = user.value?.user_metadata as Record<string, unknown> | undefined
  if (meta && typeof meta.full_name === 'string') return meta.full_name
  return user.value?.email || ''
})

const creditDisplay = computed(() => {
  return creditBalance.value ?? 0
})

// --- Workspace management ---

function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch (err) {
    console.warn('[imagio-sidebar] failed to load workspaces from localStorage', err)
  }
  return [{ id: crypto.randomUUID(), name: '新工作区' }]
}

function loadActiveId(workspaces: Workspace[]): string {
  const stored = localStorage.getItem(ACTIVE_WORKSPACE_KEY)
  if (stored && workspaces.some(w => w.id === stored)) return stored
  return workspaces[0]?.id || ''
}

const workspaces = ref<Workspace[]>(loadWorkspaces())
const activeWorkspaceId = ref(loadActiveId(workspaces.value))

function persistWorkspaces() {
  localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces.value))
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId.value)
}

function addWorkspace() {
  const index = workspaces.value.length + 1
  const ws: Workspace = { id: crypto.randomUUID(), name: `新工作区 ${index}` }
  workspaces.value.push(ws)
  activeWorkspaceId.value = ws.id
  persistWorkspaces()
}

function selectWorkspace(id: string) {
  activeWorkspaceId.value = id
  persistWorkspaces()
}

refreshCredits()
</script>

<template>
  <aside class="imagio-sidebar">
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

    <!-- Workspace section -->
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

    <!-- History section -->
    <div class="sidebar-section history-section">
      <div class="section-header history-header">
        <span>历史记录</span>
        <span class="history-meta">
          <span v-if="isLoadingHistory" class="history-loading">加载中...</span>
          <span v-else class="history-count">{{ historyImages.length }} 个任务</span>
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
.imagio-sidebar {
  width: 286px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  overflow: hidden;
}

/* --- Mode switch: Imagio / 画布 --- */
.mode-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 14px 18px;
  padding: 4px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--muted));
  font-size: 14px;
  font-weight: 800;
}

.mode-switch button {
  flex: 1;
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-md, 7px);
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-family: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.mode-switch button.active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  box-shadow: var(--shadow-sm);
}

/* --- Section common --- */
.sidebar-section {
  padding: 0 14px 14px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: hsl(var(--foreground));
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
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.15s;
}

.plus-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

/* --- Workspace section --- */
.workspace-section {
  border-bottom: 1px solid hsl(var(--border));
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
  border-radius: var(--radius-md, 7px);
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.workspace-item:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.workspace-item.active {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.drag-handle {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
  opacity: 0.55;
}

.ws-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- History section --- */
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

.history-loading {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
}

.history-count {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 700;
}

.clear-btn {
  border: 0;
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.15s;
}

.clear-btn:hover {
  color: hsl(var(--foreground));
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
  border-radius: var(--radius-md, 7px);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.history-task:hover {
  background: hsl(var(--accent));
}

.task-thumb {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid hsl(var(--border));
}

.task-thumb-placeholder {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: hsl(var(--muted));
}

.task-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.task-title {
  overflow: hidden;
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-status {
  display: flex;
  align-items: center;
  gap: 4px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 700;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: hsl(var(--foreground));
  flex-shrink: 0;
}

.history-empty {
  padding: 24px 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  text-align: center;
}

/* --- Responsive --- */
@media (max-width: 980px) {
  .imagio-sidebar {
    width: 220px;
  }
}

@media (max-width: 760px) {
  .imagio-sidebar {
    display: none;
  }
}
</style>
