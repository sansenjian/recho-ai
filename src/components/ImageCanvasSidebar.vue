<script setup lang="ts">
import { computed, ref } from 'vue'
import { MINI_MAP_VIEW, type CanvasNodeType, type WorkspaceMode } from '../lib/image-canvas-model'
import { displayImageUrl } from '../lib/image-gallery'
import type { GeneratedImage } from '../types/image'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, GripVertical, Type, Image, Sparkles } from '@lucide/vue'

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
  <aside class="w-[286px] shrink-0 flex flex-col border-r border-border bg-background overflow-hidden max-lg:w-[220px] max-md:hidden">
    <!-- Mode switch: Imagio / 画布 -->
    <div class="flex items-center gap-2 mx-3.5 my-[18px] p-1 border border-border rounded-lg bg-muted text-sm font-extrabold">
      <button
        type="button"
        :class="[
          'flex-1 min-h-[34px] px-3 py-0 border-0 rounded-md bg-transparent text-muted-foreground text-[13px] font-extrabold cursor-pointer transition-all duration-200',
          imageMode !== 'canvas' ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
        ]"
        @click="emit('select-image-mode', 'imagio')"
      >
        Imagio
      </button>
      <button
        type="button"
        :class="[
          'flex-1 min-h-[34px] px-3 py-0 border-0 rounded-md bg-transparent text-muted-foreground text-[13px] font-extrabold cursor-pointer transition-all duration-200',
          imageMode === 'canvas' ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
        ]"
        @click="emit('select-image-mode', 'canvas')"
      >
        画布
      </button>
    </div>

    <!-- Workspace list -->
    <div class="px-3.5 pb-[18px] mb-1 border-b border-border">
      <div class="flex items-center justify-between mb-2 text-foreground text-xs font-extrabold">
        <span>工作区</span>
        <Button variant="ghost" size="icon-xs" class="text-muted-foreground hover:text-foreground" title="新建工作区" @click="addWorkspace">
          <Plus :size="14" />
        </Button>
      </div>
      <div class="flex flex-col gap-0.5">
        <button
          v-for="ws in workspaces"
          :key="ws.id"
          type="button"
          :class="[
            'flex items-center gap-2 w-full min-h-[38px] px-2.5 py-0 border-0 rounded-md bg-transparent text-muted-foreground text-[13px] font-bold cursor-pointer text-left transition-colors duration-150',
            ws.id === activeWorkspaceId ? 'bg-accent text-foreground' : 'hover:bg-accent hover:text-foreground',
          ]"
          @click="selectWorkspace(ws.id)"
        >
          <GripVertical :size="14" class="shrink-0 text-muted-foreground opacity-[0.55]" />
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ ws.name }}</span>
        </button>
      </div>
    </div>

    <!-- Canvas-specific: mini-map + quick create -->
    <div class="px-3.5 pb-[18px] mb-1 border-b border-border">
      <div class="h-[156px] p-2.5 border border-border rounded-lg shadow-sm" :style="{ background: 'linear-gradient(hsl(var(--border) / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.6) 1px, transparent 1px), hsl(var(--card))', backgroundSize: '18px 18px' }">
        <div class="relative h-full border border-border rounded-md overflow-hidden">
          <svg
            class="block w-full h-full"
            :viewBox="`0 0 ${MINI_MAP_VIEW.width} ${MINI_MAP_VIEW.height}`"
            preserveAspectRatio="none"
          >
            <path
              v-for="connection in miniMapLayout.connections"
              :key="connection.id"
              class="fill-none stroke-muted-foreground [stroke-width:0.7] [stroke-linecap:round]"
              :d="connection.d"
            />
            <rect
              v-for="node in miniMapLayout.nodes"
              :key="node.id"
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
              rx="1.6"
              :class="[
                node.type === 'text' ? 'fill-muted' : '',
                node.type === 'image' ? 'fill-muted' : '',
                node.type === 'generation' ? 'fill-accent' : 'fill-background',
                node.selected ? 'stroke-foreground [stroke-width:0.9]' : 'stroke-border [stroke-width:0.55]',
              ]"
            />
            <rect
              v-if="miniMapLayout.viewport"
              class="fill-foreground/6 stroke-foreground [stroke-width:0.9] [stroke-dasharray:3_2] pointer-events-none"
              :x="miniMapLayout.viewport.x"
              :y="miniMapLayout.viewport.y"
              :width="miniMapLayout.viewport.width"
              :height="miniMapLayout.viewport.height"
              rx="2"
            />
          </svg>
        </div>
      </div>

      <div class="flex justify-center gap-2.5 mt-3.5">
        <Button variant="outline" size="icon" class="w-10 h-10 text-muted-foreground hover:text-foreground hover:bg-accent" title="创建文本节点" @click="emit('create-node', 'text')">
          <Type :size="18" stroke-width="1.8" />
        </Button>
        <Button variant="outline" size="icon" class="w-10 h-10 text-muted-foreground hover:text-foreground hover:bg-accent" title="创建图片节点" @click="emit('create-node', 'image')">
          <Image :size="18" stroke-width="1.8" />
        </Button>
        <Button size="icon" class="w-10 h-10" title="创建生图节点" @click="emit('create-node', 'generation')">
          <Sparkles :size="18" stroke-width="1.8" />
        </Button>
      </div>
    </div>

    <!-- History section (unified style) -->
    <ScrollArea class="flex-1 min-h-0 pt-3">
      <div class="px-3.5 pb-3.5">
        <div class="flex items-center justify-between mb-2 text-foreground text-xs font-extrabold">
          <span>历史记录</span>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground text-[11px] font-bold">{{ historyCountText }}</span>
            <button
              v-if="hasGeneratedImages"
              type="button"
              class="border-0 bg-transparent text-muted-foreground text-[11px] font-bold cursor-pointer transition-colors duration-150 hover:text-foreground"
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
            class="grid grid-cols-[44px_1fr] items-center gap-2.5 w-full px-2 py-1.5 border-0 rounded-md bg-transparent cursor-pointer text-left transition-colors duration-150 hover:bg-accent"
            @click="emit('use-history-image', image)"
          >
            <img
              v-if="displayImageUrl(image)"
              :src="displayImageUrl(image)"
              :alt="image.prompt"
              loading="lazy"
              class="w-11 h-11 rounded-md object-cover border border-border"
            >
            <div v-else class="w-11 h-11 rounded-md bg-muted" />
            <div class="flex flex-col gap-[3px] min-w-0">
              <span class="overflow-hidden text-foreground text-xs font-bold text-ellipsis whitespace-nowrap">{{ image.prompt || image.size }}</span>
              <span class="flex items-center gap-1 text-muted-foreground text-[11px] font-bold">
                <span class="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
                完成 · 1/1
              </span>
            </div>
          </button>
        </div>
        <div v-else class="py-6 text-muted-foreground text-xs text-center">暂无记录</div>
      </div>
    </ScrollArea>
  </aside>
</template>
