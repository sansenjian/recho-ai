<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  conversations,
  groups,
  activeConversationId,
  createConversation,
  switchConversation,
  deleteConversation,
  createGroup,
  deleteGroup,
  renameGroup,
  recolorGroup,
  assignToGroup,
} from '../stores/chat'
import { GROUP_COLORS } from '../types'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Plus, Search, X, ChevronRight, Trash2, Pencil, Palette } from '@lucide/vue'

const emit = defineEmits<{
  close: []
}>()

const searchQuery = ref('')
const expandedGroups = ref<Set<string>>(new Set(groups.value.map(g => g.id)))
const creatingGroup = ref(false)
const newGroupName = ref('')
const contextMenu = ref<{ groupId: string; x: number; y: number } | null>(null)
const renamingGroup = ref<string | null>(null)
const renameValue = ref('')
const dragConvId = ref<string | null>(null)
const dragOverGroupId = ref<string | null>(null)

// Ensure "ungrouped" is always in expanded set
expandedGroups.value.add('__ungrouped__')

const filteredConversations = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return conversations.value
  return conversations.value.filter(c => c.title.toLowerCase().includes(q))
})

interface GroupedSection {
  groupId: string | null
  groupName: string
  groupColor: string | null
  convs: typeof conversations.value
}

const groupedSections = computed<GroupedSection[]>(() => {
  const filtered = filteredConversations.value
  const sections: GroupedSection[] = []

  // Groups in order
  for (const g of groups.value) {
    const convs = filtered.filter(c => c.groupId === g.id)
    if (convs.length > 0 || !searchQuery.value) {
      sections.push({ groupId: g.id, groupName: g.name, groupColor: g.color, convs })
    }
  }

  // Ungrouped
  const ungrouped = filtered.filter(c => !c.groupId)
  sections.push({ groupId: '__ungrouped__', groupName: '未分组', groupColor: null, convs: ungrouped })

  return sections
})

function toggleGroup(groupId: string) {
  if (expandedGroups.value.has(groupId)) {
    expandedGroups.value.delete(groupId)
  } else {
    expandedGroups.value.add(groupId)
  }
  // Trigger reactivity
  expandedGroups.value = new Set(expandedGroups.value)
}

function isExpanded(groupId: string) {
  return expandedGroups.value.has(groupId)
}

function confirmCreateGroup() {
  const name = newGroupName.value.trim()
  if (name) {
    const g = createGroup(name)
    expandedGroups.value.add(g.id)
  }
  creatingGroup.value = false
  newGroupName.value = ''
}

function cancelCreateGroup() {
  creatingGroup.value = false
  newGroupName.value = ''
}

function onGroupContextMenu(e: MouseEvent, groupId: string) {
  e.preventDefault()
  if (groupId === '__ungrouped__') return
  contextMenu.value = { groupId, x: e.clientX, y: e.clientY }
}

function startRename(groupId: string) {
  const g = groups.value.find(g => g.id === groupId)
  if (g) renameValue.value = g.name
  renamingGroup.value = groupId
  contextMenu.value = null
}

function confirmRename() {
  if (renamingGroup.value && renameValue.value.trim()) {
    renameGroup(renamingGroup.value, renameValue.value.trim())
  }
  renamingGroup.value = null
  renameValue.value = ''
}

function handleDeleteGroup(groupId: string) {
  deleteGroup(groupId)
  contextMenu.value = null
}

function handleRecolor(groupId: string, color: string) {
  recolorGroup(groupId, color)
  contextMenu.value = null
}

// --- drag and drop ---
function onDragStart(e: DragEvent, convId: string) {
  dragConvId.value = convId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', convId)
  }
}

function onDragOver(e: DragEvent, groupId: string | null) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverGroupId.value = groupId
  // Auto-expand group on hover during drag
  if (groupId && groupId !== '__ungrouped__' && !expandedGroups.value.has(groupId)) {
    expandedGroups.value.add(groupId)
    expandedGroups.value = new Set(expandedGroups.value)
  }
}

function onDragLeave(groupId: string | null) {
  if (dragOverGroupId.value === groupId) {
    dragOverGroupId.value = null
  }
}

function onDrop(e: DragEvent, groupId: string | null) {
  e.preventDefault()
  dragOverGroupId.value = null
  const id = dragConvId.value
  dragConvId.value = null
  if (id != null) {
    assignToGroup(id, groupId === '__ungrouped__' ? null : groupId)
  }
}

function onDragEnd() {
  dragConvId.value = null
  dragOverGroupId.value = null
}

// Close context menu on any click outside
function onContextMenuBackdrop() {
  contextMenu.value = null
}
</script>

<template>
  <aside class="relative flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-background">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <span class="text-[11px] font-semibold uppercase tracking-[0.04em] text-foreground">History</span>
      <Button
        variant="outline"
        size="icon"
        class="h-[26px] w-[26px] text-muted-foreground shadow-sm"
        title="New Chat"
        @click="createConversation()"
      >
        <Plus class="h-[15px] w-[15px]" />
      </Button>
    </div>

    <!-- Search -->
    <div class="mx-2 my-1.5 flex items-center gap-1.5 rounded-md bg-card px-2.5 py-2 ring-1 ring-border">
      <Search class="h-[13px] w-[13px] shrink-0 text-muted-foreground" />
      <Input
        v-model="searchQuery"
        class="h-auto border-0 bg-transparent p-0 text-xs text-foreground shadow-none outline-none placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
        placeholder="搜索会话..."
        @keydown.escape="searchQuery = ''"
      />
      <Button
        v-if="searchQuery"
        variant="ghost"
        size="icon"
        class="h-[18px] w-[18px] shrink-0 rounded-full text-muted-foreground"
        @click="searchQuery = ''"
      >
        <X class="h-[11px] w-[11px]" />
      </Button>
    </div>

    <!-- Conversation list -->
    <ScrollArea class="flex-1 px-1.5 pb-1.5">
      <!-- Grouped sections -->
      <div
        v-for="section in groupedSections"
        :key="section.groupId ?? '__ungrouped__'"
        class="mb-0.5 rounded-md transition-colors"
        :class="{
          'bg-muted outline outline-2 outline-dashed outline-border -outline-offset-2': dragOverGroupId === section.groupId,
        }"
        @dragover="onDragOver($event, section.groupId)"
        @dragleave="onDragLeave(section.groupId)"
        @drop="onDrop($event, section.groupId)"
      >
        <!-- Group header -->
        <div
          role="button"
          tabindex="0"
          class="flex w-full cursor-pointer select-none items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="{ 'cursor-default': section.groupId === '__ungrouped__', 'mt-2 border-t border-border pt-1': section.groupId === '__ungrouped__' }"
          :aria-expanded="isExpanded(section.groupId!)"
          @click="toggleGroup(section.groupId!)"
          @keydown.enter.prevent="toggleGroup(section.groupId!)"
          @keydown.space.prevent="toggleGroup(section.groupId!)"
          @contextmenu="onGroupContextMenu($event, section.groupId!)"
        >
          <ChevronRight
            class="h-[11px] w-[11px] shrink-0 text-muted-foreground transition-transform"
            :class="{ '-rotate-90': !isExpanded(section.groupId!) }"
          />
          <span v-if="section.groupColor" class="h-[7px] w-[7px] shrink-0 rounded-full" :style="{ background: section.groupColor }" />
          <span v-if="renamingGroup === section.groupId" class="min-w-0 flex-1" @click.stop>
            <Input
              v-model="renameValue"
              class="h-auto rounded bg-card px-1.5 py-0.5 text-[10px] font-semibold shadow-none outline-none ring-1 ring-primary focus-visible:ring-1 focus-visible:ring-offset-0"
              @keydown.enter.stop="confirmRename()"
              @keydown.escape.stop="renamingGroup = null"
              @keydown.space.stop
              @blur="confirmRename()"
              autofocus
            />
          </span>
          <span v-else class="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{{ section.groupName }}</span>
          <span class="shrink-0 rounded-full bg-accent px-1.5 py-px text-[9px] text-muted-foreground/70">{{ section.convs.length }}</span>
        </div>

        <!-- Conversations in group -->
        <div v-if="isExpanded(section.groupId!)" class="py-px pl-1.5">
          <div
            v-for="conv in section.convs"
            :key="conv.id"
            role="button"
            tabindex="0"
            class="group flex w-full cursor-pointer items-center gap-[5px] rounded-[var(--radius-md,7px)] border-0 border-l-2 border-l-transparent bg-transparent px-[7px] py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="{ 'bg-accent': conv.id === activeConversationId }"
            :style="section.groupColor && conv.id === activeConversationId ? { borderLeftColor: section.groupColor } : {}"
            draggable="true"
            :aria-current="conv.id === activeConversationId ? 'page' : undefined"
            @click="switchConversation(conv.id); emit('close')"
            @keydown.enter.prevent="switchConversation(conv.id); emit('close')"
            @keydown.space.prevent="switchConversation(conv.id); emit('close')"
            @dragstart="onDragStart($event, conv.id)"
            @dragend="onDragEnd"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-px">
              <span class="truncate text-xs font-medium text-foreground">{{ conv.title }}</span>
              <span class="text-[10px] text-muted-foreground">{{ conv.updatedAt }}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="hidden h-[18px] w-[18px] text-muted-foreground group-hover:flex"
              title="Delete"
              @click.stop="deleteConversation(conv.id)"
              @keydown.enter.stop
              @keydown.space.stop
            >
              <Trash2 class="h-3 w-3" />
            </Button>
          </div>
          <div v-if="section.convs.length === 0 && section.groupId !== '__ungrouped__'" class="my-1 rounded-md border border-dashed border-border px-2 py-2.5 text-center text-[11px] text-muted-foreground">
            拖拽会话到此处
          </div>
        </div>
      </div>

      <!-- Add group button -->
      <button
        v-if="!creatingGroup"
        type="button"
        class="my-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="creatingGroup = true"
      >
        <Plus class="h-[13px] w-[13px]" />
        <span>新建分组</span>
      </button>
      <div v-else class="flex items-center gap-1 px-2 py-1">
        <Input
          v-model="newGroupName"
          class="h-auto rounded-md bg-card px-2 py-1 text-[11px] shadow-none outline-none ring-1 ring-primary focus-visible:ring-1 focus-visible:ring-offset-0"
          placeholder="分组名称"
          @keydown.enter="confirmCreateGroup()"
          @keydown.escape="cancelCreateGroup()"
          autofocus
        />
        <Button
          size="sm"
          class="h-auto rounded-md px-2.5 py-1 text-[11px] font-semibold"
          @click="confirmCreateGroup"
        >
          确定
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-[22px] w-[22px] text-muted-foreground"
          @click="cancelCreateGroup"
        >
          <X class="h-[11px] w-[11px]" />
        </Button>
      </div>
    </ScrollArea>

    <!-- Context menu backdrop -->
    <div v-if="contextMenu" class="fixed inset-0 z-[200]" @click="onContextMenuBackdrop" @contextmenu.prevent="onContextMenuBackdrop" />

    <!-- Context menu -->
    <div
      v-if="contextMenu"
      class="fixed z-[201] min-w-[160px] rounded-lg bg-popover p-1 shadow-md ring-1 ring-border"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <Button
        variant="ghost"
        size="sm"
        class="h-auto w-full justify-start px-2.5 py-[5px] text-xs"
        @click="startRename(contextMenu.groupId)"
      >
        <Pencil class="mr-2 h-3 w-3" />
        重命名
      </Button>
      <div class="flex flex-wrap gap-1 px-2.5 py-1.5">
        <button
          v-for="c in GROUP_COLORS"
          :key="c"
          class="h-5 w-5 cursor-pointer rounded-full border-2 border-transparent transition-all hover:scale-110 hover:border-foreground"
          :style="{ background: c }"
          @click="handleRecolor(contextMenu.groupId, c)"
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="h-auto w-full justify-start px-2.5 py-[5px] text-xs text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20"
        @click="handleDeleteGroup(contextMenu.groupId)"
      >
        <Trash2 class="mr-2 h-3 w-3" />
        删除分组
      </Button>
    </div>
  </aside>
</template>
