<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, GripVertical } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { hasDisplayImage } from '../lib/image-gallery'
import { useCredits } from '../composables/useCredits'
import { useAuthSession } from '../composables/useAuthSession'
import type { GeneratedImage } from '../types/image'
import AuthenticatedImage from './AuthenticatedImage.vue'

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

    <!-- Workspace section -->
    <div class="px-3.5 pb-3.5 border-b border-border mb-1">
      <div class="flex items-center justify-between mb-2 text-foreground text-xs font-extrabold">
        <span>工作区</span>
        <Button
          variant="ghost"
          size="icon"
          class="w-6 h-6 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          title="新建工作区"
          @click="addWorkspace"
        >
          <Plus class="w-3.5 h-3.5" />
        </Button>
      </div>
      <div class="flex flex-col gap-0.5">
        <Button
          v-for="ws in workspaces"
          :key="ws.id"
          variant="ghost"
          class="w-full justify-start gap-2 min-h-[38px] px-2.5 py-0 text-[13px] font-bold text-left rounded-md text-muted-foreground"
          :class="{ 'bg-accent text-accent-foreground': ws.id === activeWorkspaceId }"
          @click="selectWorkspace(ws.id)"
        >
          <GripVertical class="shrink-0 w-3.5 h-3.5 text-muted-foreground opacity-[0.55]" />
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {{ ws.name }}
          </span>
        </Button>
      </div>
    </div>

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
  </aside>
</template>
