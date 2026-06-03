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
const dragConvId = ref<number | null>(null)
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
function onDragStart(e: DragEvent, convId: number) {
  dragConvId.value = convId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(convId))
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
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">History</span>
      <button class="new-chat-btn" @click="createConversation()" title="New Chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>

    <div class="sidebar-search">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="searchQuery"
        class="search-input"
        placeholder="搜索会话..."
        @keydown.escape="searchQuery = ''"
      />
      <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="sidebar-list">
      <!-- Grouped sections -->
      <div
        v-for="section in groupedSections"
        :key="section.groupId ?? '__ungrouped__'"
        class="group-section"
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
          class="group-header"
          :class="{ 'is-ungrouped': section.groupId === '__ungrouped__' }"
          @click="toggleGroup(section.groupId!)"
          @contextmenu="onGroupContextMenu($event, section.groupId!)"
        >
          <svg
            class="group-chevron"
            :class="{ collapsed: !isExpanded(section.groupId!) }"
            viewBox="0 0 16 16"
            fill="currentColor"
            width="12"
            height="12"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span v-if="section.groupColor" class="group-dot" :style="{ background: section.groupColor }" />
          <span v-if="renamingGroup === section.groupId" class="group-rename-input-wrapper" @click.stop>
            <input
              v-model="renameValue"
              class="group-rename-input"
              @keydown.enter="confirmRename()"
              @keydown.escape="renamingGroup = null"
              @blur="confirmRename()"
              autofocus
            />
          </span>
          <span v-else class="group-name">{{ section.groupName }}</span>
          <span class="group-count">{{ section.convs.length }}</span>
        </div>

        <!-- Conversations in group -->
        <div v-if="isExpanded(section.groupId!)" class="group-conversations">
          <div
            v-for="conv in section.convs"
            :key="conv.id"
            class="conv-item"
            :class="{ active: conv.id === activeConversationId }"
            :style="section.groupColor ? { borderLeftColor: section.groupColor } : {}"
            draggable="true"
            @click="switchConversation(conv.id); emit('close')"
            @dragstart="onDragStart($event, conv.id)"
            @dragend="onDragEnd"
          >
            <div class="conv-info">
              <span class="conv-title">{{ conv.title }}</span>
              <span class="conv-time">{{ conv.updatedAt }}</span>
            </div>
            <button
              class="conv-delete"
              @click.stop="deleteConversation(conv.id)"
              title="Delete"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div v-if="section.convs.length === 0 && section.groupId !== '__ungrouped__'" class="empty-group">
            拖拽会话到此处
          </div>
        </div>
      </div>

      <!-- Add group button -->
      <div v-if="!creatingGroup" class="add-group-btn" @click="creatingGroup = true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>新建分组</span>
      </div>
      <div v-else class="create-group-row">
        <input
          v-model="newGroupName"
          class="create-group-input"
          placeholder="分组名称"
          @keydown.enter="confirmCreateGroup()"
          @keydown.escape="cancelCreateGroup()"
          autofocus
        />
        <button class="create-group-ok" @click="confirmCreateGroup">确定</button>
        <button class="create-group-cancel" @click="cancelCreateGroup">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Context menu backdrop -->
    <div v-if="contextMenu" class="context-menu-backdrop" @click="onContextMenuBackdrop" @contextmenu.prevent="onContextMenuBackdrop" />

    <!-- Context menu -->
    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <button class="context-menu-item" @click="startRename(contextMenu.groupId)">重命名</button>
      <div class="context-menu-colors">
        <button
          v-for="c in GROUP_COLORS"
          :key="c"
          class="color-swatch"
          :style="{ background: c }"
          @click="handleRecolor(contextMenu.groupId, c)"
        />
      </div>
      <button class="context-menu-item danger" @click="handleDeleteGroup(contextMenu.groupId)">删除分组</button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  height: 100%;
  background: #f8fafc;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.sidebar-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--text-primary);
}

.new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  box-shadow: var(--shadow-sm);
}

.new-chat-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.sidebar-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  margin: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--shadow-sm);
}

.search-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
}

.search-input::placeholder { color: #b0b0be; }

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: var(--hover-bg);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.search-clear:hover {
  background: #e0e0e8;
  color: var(--text-primary);
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px;
}

/* --- group section --- */
.group-section {
  margin-bottom: 2px;
  border-radius: 8px;
  transition: background 0.15s;
}

.group-section.drag-over {
  background: rgba(99, 102, 241, 0.06);
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}

.group-section.is-ungrouped {
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s;
}

.group-header:hover {
  background: var(--hover-bg);
}

.group-header.is-ungrouped {
  cursor: default;
}

.group-chevron {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: transform 0.15s;
}

.group-chevron.collapsed {
  transform: rotate(-90deg);
}

.group-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.group-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: 10px;
  color: #b0b0be;
  background: var(--hover-bg);
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
}

.group-rename-input-wrapper {
  flex: 1;
  min-width: 0;
}

.group-rename-input {
  width: 100%;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  padding: 2px 6px;
  outline: none;
  color: var(--text-primary);
}

/* --- conversations in group --- */
.group-conversations {
  padding: 2px 0 2px 8px;
}

.conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.15s;
  border-left: 2px solid transparent;
}

.conv-item:hover { background: var(--hover-bg); }

.conv-item.active {
  background: #ecfdf3;
  border-left-color: var(--accent);
}

.conv-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conv-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-time {
  font-size: 11px;
  color: var(--text-secondary);
}

.conv-delete {
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.conv-item:hover .conv-delete { display: flex; }

.conv-delete:hover {
  background: #fee2e2;
  color: #ef4444;
}

.empty-group {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: #c0c0ce;
  border: 1px dashed var(--border);
  border-radius: 6px;
  margin: 4px 0;
}

/* --- add group --- */
.add-group-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin: 4px 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
}

.add-group-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.create-group-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
}

.create-group-input {
  flex: 1;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  font-family: inherit;
  padding: 4px 8px;
  outline: none;
  color: var(--text-primary);
}

.create-group-ok {
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.create-group-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.create-group-cancel:hover { background: var(--hover-bg); }

/* --- context menu --- */
.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
}

.context-menu {
  position: fixed;
  z-index: 201;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.1);
  padding: 6px;
  min-width: 160px;
}

.context-menu-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.context-menu-item:hover { background: var(--hover-bg); }

.context-menu-item.danger { color: #ef4444; }

.context-menu-item.danger:hover { background: #fee2e2; }

.context-menu-colors {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.1s, border-color 0.1s;
}

.color-swatch:hover {
  transform: scale(1.15);
  border-color: var(--text-primary);
}
</style>
