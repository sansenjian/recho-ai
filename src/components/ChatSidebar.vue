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
  <aside class="chat-sidebar w-[240px] h-full flex flex-col shrink-0 relative">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
      <span class="text-[11px] font-semibold tracking-[0.04em] text-foreground uppercase">History</span>
      <button class="new-chat-btn" @click="createConversation()" title="New Chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>

    <!-- Search -->
    <div class="flex items-center gap-1.5 px-2.5 py-2 mx-2 my-1.5 rounded-md bg-card ring-1 ring-border">
      <svg class="shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="searchQuery"
        class="flex-1 border-0 outline-0 bg-transparent text-[12px] font-[inherit] text-foreground placeholder:text-muted-foreground/60"
        placeholder="搜索会话..."
        @keydown.escape="searchQuery = ''"
      />
      <button v-if="searchQuery" class="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-accent text-muted-foreground border-0 cursor-pointer shrink-0 hover:bg-accent/80 hover:text-foreground transition-colors" @click="searchQuery = ''">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- Conversation list -->
    <div class="flex-1 overflow-y-auto px-1.5 pb-1.5">
      <!-- Grouped sections -->
      <div
        v-for="section in groupedSections"
        :key="section.groupId ?? '__ungrouped__'"
        class="group-section mb-0.5 rounded-md transition-colors"
        :class="{
          'drag-over': dragOverGroupId === section.groupId,
          'is-ungrouped': section.groupId === '__ungrouped__',
        }"
        @dragover="onDragOver($event, section.groupId)"
        @dragleave="onDragLeave(section.groupId)"
        @drop="onDrop($event, section.groupId)"
      >
        <!-- Group header -->
        <div
          class="group-header flex items-center gap-1 px-1.5 py-1 rounded-md cursor-pointer select-none transition-colors hover:bg-accent/50"
          :class="{ 'cursor-default!': section.groupId === '__ungrouped__', 'mt-2 pt-1 border-t border-border': section.groupId === '__ungrouped__' }"
          @click="toggleGroup(section.groupId!)"
          @contextmenu="onGroupContextMenu($event, section.groupId!)"
        >
          <svg
            class="group-chevron shrink-0 text-muted-foreground transition-transform"
            :class="{ '-rotate-90': !isExpanded(section.groupId!) }"
            viewBox="0 0 16 16"
            fill="currentColor"
            width="11"
            height="11"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span v-if="section.groupColor" class="w-[7px] h-[7px] rounded-full shrink-0" :style="{ background: section.groupColor }" />
          <span v-if="renamingGroup === section.groupId" class="flex-1 min-w-0" @click.stop>
            <input
              v-model="renameValue"
              class="w-full rounded bg-card text-[10px] font-semibold font-[inherit] px-1.5 py-0.5 outline-0 text-foreground ring-1 ring-primary"
              @keydown.enter="confirmRename()"
              @keydown.escape="renamingGroup = null"
              @blur="confirmRename()"
              autofocus
            />
          </span>
          <span v-else class="flex-1 min-w-0 text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.05em] truncate">{{ section.groupName }}</span>
          <span class="text-[9px] text-muted-foreground/70 bg-accent px-1.5 py-px rounded-full shrink-0">{{ section.convs.length }}</span>
        </div>

        <!-- Conversations in group -->
        <div v-if="isExpanded(section.groupId!)" class="py-px pl-1.5">
          <div
            v-for="conv in section.convs"
            :key="conv.id"
            class="conv-item"
            :class="{ active: conv.id === activeConversationId }"
            :style="section.groupColor && conv.id === activeConversationId ? { borderLeftColor: section.groupColor } : {}"
            draggable="true"
            @click="switchConversation(conv.id); emit('close')"
            @dragstart="onDragStart($event, conv.id)"
            @dragend="onDragEnd"
          >
            <div class="flex-1 min-w-0 flex flex-col gap-px">
              <span class="text-[12px] font-medium text-foreground truncate">{{ conv.title }}</span>
              <span class="text-[10px] text-muted-foreground">{{ conv.updatedAt }}</span>
            </div>
            <button
              class="conv-delete"
              @click.stop="deleteConversation(conv.id)"
              title="Delete"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div v-if="section.convs.length === 0 && section.groupId !== '__ungrouped__'" class="py-2.5 px-2 text-center text-[11px] text-muted-foreground border border-dashed border-border rounded-md my-1">
            拖拽会话到此处
          </div>
        </div>
      </div>

      <!-- Add group button -->
      <div v-if="!creatingGroup" class="flex items-center gap-1.5 px-2.5 py-1.5 my-1 rounded-md cursor-pointer text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground" @click="creatingGroup = true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>新建分组</span>
      </div>
      <div v-else class="flex items-center gap-1 px-2 py-1">
        <input
          v-model="newGroupName"
          class="flex-1 rounded-md bg-card text-[11px] font-[inherit] px-2 py-1 outline-0 text-foreground ring-1 ring-primary"
          placeholder="分组名称"
          @keydown.enter="confirmCreateGroup()"
          @keydown.escape="cancelCreateGroup()"
          autofocus
        />
        <button class="cursor-pointer rounded-md border-0 bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background transition-opacity hover:opacity-85" @click="confirmCreateGroup">确定</button>
        <button class="flex items-center justify-center w-[22px] h-[22px] rounded-md bg-transparent border-0 text-muted-foreground cursor-pointer hover:bg-accent transition-colors" @click="cancelCreateGroup">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="11" height="11">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Context menu backdrop -->
    <div v-if="contextMenu" class="fixed inset-0 z-[200]" @click="onContextMenuBackdrop" @contextmenu.prevent="onContextMenuBackdrop" />

    <!-- Context menu -->
    <div
      v-if="contextMenu"
      class="fixed z-[201] bg-popover rounded-lg shadow-md ring-1 ring-border p-1 min-w-[160px]"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <button class="ctx-item" @click="startRename(contextMenu.groupId)">重命名</button>
      <div class="flex gap-1 px-2.5 py-1.5 flex-wrap">
        <button
          v-for="c in GROUP_COLORS"
          :key="c"
          class="w-5 h-5 rounded-full border-2 border-transparent cursor-pointer transition-all hover:scale-110 hover:border-foreground"
          :style="{ background: c }"
          @click="handleRecolor(contextMenu.groupId, c)"
        />
      </div>
      <button class="ctx-item text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" @click="handleDeleteGroup(contextMenu.groupId)">删除分组</button>
    </div>
  </aside>
</template>

<style scoped>
.chat-sidebar {
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--background));
}

.new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
  box-shadow: var(--shadow-sm);
}

.new-chat-btn:hover {
  border-color: hsl(var(--ring));
  background: hsl(var(--foreground));
  color: hsl(var(--background));
}

/* Drag-over state */
.group-section.drag-over {
  background: hsl(var(--muted));
  outline: 2px dashed hsl(var(--border));
  outline-offset: -2px;
}

/* Conversation items — admin nav-item style */
.conv-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 7px;
  border-radius: var(--radius-md, 7px);
  cursor: pointer;
  transition: background 150ms ease;
  border-left: 2px solid transparent;
}

.conv-item:hover {
  background: hsl(var(--accent));
}

.conv-item.active {
  background: hsl(var(--accent));
  border-left-color: hsl(var(--foreground));
}

.conv-delete {
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  flex-shrink: 0;
}

.conv-item:hover .conv-delete {
  display: flex;
}

.conv-delete:hover {
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
}

/* Context menu items */
.ctx-item {
  display: block;
  width: 100%;
  padding: 5px 10px;
  border: none;
  border-radius: var(--radius-md, 7px);
  background: transparent;
  font-size: 12px;
  font-family: inherit;
  color: hsl(var(--foreground));
  text-align: left;
  cursor: pointer;
  transition: background 100ms ease;
}

.ctx-item:hover {
  background: hsl(var(--accent));
}
</style>
