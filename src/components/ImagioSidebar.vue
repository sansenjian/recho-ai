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
}>()

const emit = defineEmits<{
  'select-image-mode': [mode: 'imagio' | 'canvas']
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

// Refresh credits on mount
refreshCredits()
</script>

<template>
  <aside class="imagio-sidebar">
    <!-- Header -->
    <div class="sidebar-header">
      <span class="logo-label">Imagio</span>
      <button
        type="button"
        class="mode-toggle-btn"
        @click="emit('select-image-mode', 'canvas')"
      >
        画布
      </button>
    </div>

    <!-- Workspace section -->
    <div class="sidebar-section">
      <div class="section-header">
        <span>工作区</span>
        <button type="button" class="icon-btn" title="新建工作区" @click="addWorkspace">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">
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
          <span class="ws-name">{{ ws.name }}</span>
        </button>
      </div>
    </div>

    <!-- History section -->
    <div class="sidebar-section history-section">
      <div class="section-header">
        <span>历史记录</span>
        <span class="history-meta">
          <span class="history-count">{{ historyImages.length }} 个任务</span>
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

    <!-- Bottom status bar -->
    <div class="sidebar-footer">
      <div class="footer-info">
        <span class="credit-label">剩余额度: {{ creditDisplay }}</span>
        <span v-if="userName" class="user-name">{{ userName }}</span>
      </div>
      <div class="footer-actions">
        <button type="button" class="icon-btn" title="刷新额度" @click="refreshCredits">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.imagio-sidebar {
  width: 286px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, #f9fafb 0%, #ffffff 100%);
  overflow-y: auto;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;
}

.logo-label {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 800;
}

.mode-toggle-btn {
  min-height: 30px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s;
}

.mode-toggle-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.sidebar-section {
  padding: 6px 14px 12px;
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

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.icon-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.workspace-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.workspace-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}

.workspace-item:hover {
  background: var(--hover-bg);
}

.workspace-item.active {
  background: #f0f2f5;
  color: var(--text-primary);
}

.ws-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.history-meta {
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
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.clear-btn:hover {
  color: var(--text-primary);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-task {
  display: grid;
  grid-template-columns: 42px 1fr;
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
  width: 42px;
  height: 42px;
  border-radius: 6px;
  object-fit: cover;
}

.task-thumb-placeholder {
  width: 42px;
  height: 42px;
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

.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: auto 10px 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  flex-shrink: 0;
}

.footer-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.credit-label {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
}

.user-name {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

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
