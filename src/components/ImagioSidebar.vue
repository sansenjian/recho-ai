<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { hasDisplayImage } from '../lib/image-gallery'
import { removeNamedWorkspace, type NamedWorkspace } from '../lib/workspace-list'
import { useCredits } from '../composables/useCredits'
import { useAuthSession } from '../composables/useAuthSession'
import type { GeneratedImage } from '../types/image'
import AuthenticatedImage from './AuthenticatedImage.vue'
import WorkspaceList from './WorkspaceList.vue'

type Workspace = NamedWorkspace

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
const pendingRemoveWorkspaceId = ref<string | null>(null)

const pendingRemoveWorkspace = computed(() =>
  workspaces.value.find(workspace => workspace.id === pendingRemoveWorkspaceId.value) ?? null,
)

const removeWorkspaceDialogOpen = computed({
  get: () => pendingRemoveWorkspaceId.value !== null,
  set: (open: boolean) => {
    if (!open) pendingRemoveWorkspaceId.value = null
  },
})

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

function requestRemoveWorkspace(id: string) {
  if (workspaces.value.length <= 1 || !workspaces.value.some(workspace => workspace.id === id)) {
    return
  }
  pendingRemoveWorkspaceId.value = id
}

function removeWorkspace(id: string) {
  const next = removeNamedWorkspace(workspaces.value, activeWorkspaceId.value, id)
  if (!next) {
    pendingRemoveWorkspaceId.value = null
    return
  }

  workspaces.value = next.workspaces
  activeWorkspaceId.value = next.activeId
  pendingRemoveWorkspaceId.value = null
  persistWorkspaces()
}

refreshCredits()
</script>

<template>
  <aside
    class="w-[286px] shrink-0 flex flex-col border-r border-border bg-background overflow-hidden max-[980px]:w-[220px] max-[760px]:hidden"
  >
    <!-- Mode switch: Imagio / 画布 -->
    <div class="flex items-center gap-2 m-[18px_14px_18px] p-1 border border-border rounded-lg bg-muted">
      <button
        type="button"
        :class="[
          'flex-1 min-h-[34px] px-3 py-0 border-0 rounded-md text-[13px] font-extrabold cursor-pointer transition-all duration-200',
          imageMode !== 'canvas' ? 'bg-background text-foreground shadow-sm' : 'bg-transparent text-muted-foreground hover:text-foreground',
        ]"
        @click="emit('select-image-mode', 'imagio')"
      >
        Imagio
      </button>
      <button
        type="button"
        :class="[
          'flex-1 min-h-[34px] px-3 py-0 border-0 rounded-md text-[13px] font-extrabold cursor-pointer transition-all duration-200',
          imageMode === 'canvas' ? 'bg-background text-foreground shadow-sm' : 'bg-transparent text-muted-foreground hover:text-foreground',
        ]"
        @click="emit('select-image-mode', 'canvas')"
      >
        画布
      </button>
    </div>

    <!-- Workspace section (shared with canvas sidebar) -->
    <WorkspaceList
      :workspaces="workspaces"
      :active-id="activeWorkspaceId"
      create-label="新建工作区"
      keep-one-hint="至少保留一个工作区"
      @select="selectWorkspace"
      @create="addWorkspace"
      @remove="requestRemoveWorkspace"
    />

    <!-- History section -->
    <div class="flex-1 min-h-0 overflow-y-auto pt-3 px-3.5 pb-3.5">
      <div class="flex items-center justify-between mb-2 text-foreground text-xs font-extrabold">
        <span>历史记录</span>
        <div class="flex items-center gap-2">
          <span v-if="isLoadingHistory" class="text-muted-foreground text-[11px] font-bold opacity-70">
            加载中...
          </span>
          <span v-else class="text-muted-foreground text-[11px] font-bold">
            {{ historyImages.length }} 个任务
          </span>
          <button
            v-if="hasGeneratedImages"
            type="button"
            class="border-0 bg-transparent text-muted-foreground text-[11px] font-bold cursor-pointer transition-colors hover:text-foreground"
            @click="emit('clear-history')"
          >
            清空历史
          </button>
        </div>
      </div>
      <div v-if="historyImages.length" class="flex flex-col gap-0.5">
        <button
          v-for="image in historyImages"
          :key="image.id"
          type="button"
          class="grid grid-cols-[44px_1fr] items-center gap-2.5 w-full px-2 py-1.5 border-0 rounded-md bg-transparent cursor-pointer text-left transition-colors hover:bg-accent"
          @click="emit('use-history-image', image)"
        >
          <AuthenticatedImage
            v-if="hasDisplayImage(image)"
            :source="image"
            :alt="image.prompt"
            loading="lazy"
            class="w-11 h-11 rounded-md object-cover border border-border"
          />
          <div v-else class="w-11 h-11 rounded-md bg-muted" />
          <div class="flex flex-col gap-[3px] min-w-0">
            <span class="overflow-hidden text-foreground text-xs font-bold text-ellipsis whitespace-nowrap">
              {{ image.prompt || image.size }}
            </span>
            <span class="flex items-center gap-1 text-muted-foreground text-[11px] font-bold">
              <span class="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
              完成 · 1/1
            </span>
          </div>
        </button>
      </div>
      <div v-else class="py-6 text-muted-foreground text-xs text-center">
        暂无记录
      </div>
    </div>

    <Dialog v-model:open="removeWorkspaceDialogOpen">
      <DialogHeader>
        <DialogTitle>删除工作区？</DialogTitle>
        <DialogDescription>
          “{{ pendingRemoveWorkspace?.name }}”将从工作区列表中移除，且无法恢复。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="mt-6 gap-2">
        <Button type="button" variant="outline" @click="removeWorkspaceDialogOpen = false">取消</Button>
        <Button type="button" variant="destructive" @click="pendingRemoveWorkspaceId && removeWorkspace(pendingRemoveWorkspaceId)">删除</Button>
      </DialogFooter>
    </Dialog>
  </aside>
</template>
