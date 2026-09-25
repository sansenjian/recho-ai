<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { GripVertical, Pencil, Plus, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import type { NamedWorkspace } from '../lib/workspace-list'

const props = withDefaults(defineProps<{
  workspaces: NamedWorkspace[]
  activeId: string
  /** 顶部新建按钮的 title / aria-label，如「新建画布」「新建工作区」 */
  createLabel: string
  /** 只剩一个工作区时删除按钮的禁用提示 */
  keepOneHint: string
  /** 分组标题，默认「工作区」 */
  title?: string
}>(), {
  title: '工作区',
})

const emit = defineEmits<{
  select: [id: string]
  create: []
  remove: [id: string]
  rename: [id: string, name: string]
}>()

const canRemove = computed(() => props.workspaces.length > 1)
const contextWorkspaceId = ref<string | null>(null)
const editingWorkspaceId = ref<string | null>(null)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null)
const listRoot = ref<HTMLElement | null>(null)

function openContextMenu(id: string) {
  editingWorkspaceId.value = null
  contextWorkspaceId.value = id
}

function startRename(workspace: NamedWorkspace) {
  contextWorkspaceId.value = null
  editingWorkspaceId.value = workspace.id
  nameDraft.value = workspace.name
  void nextTick(() => {
    const input = Array.isArray(nameInput.value) ? nameInput.value[0] : nameInput.value
    input?.focus()
    input?.select()
  })
}

function finishRename(save: boolean) {
  const id = editingWorkspaceId.value
  if (!id) return
  editingWorkspaceId.value = null
  const name = nameDraft.value.trim()
  if (save && name && name !== props.workspaces.find(workspace => workspace.id === id)?.name) {
    emit('rename', id, name)
  }
}

function closeOnOutsidePointer(event: PointerEvent) {
  if (!listRoot.value?.contains(event.target as Node)) contextWorkspaceId.value = null
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') contextWorkspaceId.value = null
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutsidePointer)
  document.addEventListener('keydown', closeOnEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutsidePointer)
  document.removeEventListener('keydown', closeOnEscape)
})

function removeHint(workspace: NamedWorkspace): string {
  return canRemove.value ? `删除${workspace.name}` : props.keepOneHint
}
</script>

<template>
  <div ref="listRoot" class="px-3.5 pb-[18px] mb-1 border-b border-border">
    <div class="flex items-center justify-between mb-2 text-foreground text-xs font-extrabold">
      <span>{{ title }}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        class="text-muted-foreground hover:text-foreground"
        :title="createLabel"
        :aria-label="createLabel"
        @click="emit('create')"
      >
        <Plus :size="14" />
      </Button>
    </div>
    <div class="flex flex-col gap-0.5">
      <div
        v-for="ws in workspaces"
        :key="ws.id"
        class="group relative flex items-center gap-1 w-full min-h-[38px] rounded-md transition-colors duration-150"
        @contextmenu.prevent="openContextMenu(ws.id)"
      >
        <input
          v-if="editingWorkspaceId === ws.id"
          ref="nameInput"
          v-model="nameDraft"
          type="text"
          maxlength="80"
          :aria-label="`重命名${ws.name}`"
          class="min-w-0 flex-1 h-8 px-2 rounded-md border border-ring bg-background text-foreground text-[13px] outline-none"
          @keydown.enter.prevent="finishRename(true)"
          @keydown.esc.prevent="finishRename(false)"
          @blur="finishRename(true)"
        >
        <button
          v-else
          type="button"
          :class="[
            'flex items-center gap-2 min-w-0 flex-1 min-h-[38px] px-2.5 py-0 border-0 rounded-md bg-transparent text-muted-foreground text-[13px] font-bold cursor-pointer text-left transition-colors duration-150',
            ws.id === activeId ? 'bg-accent text-foreground' : 'hover:bg-accent hover:text-foreground',
          ]"
          @click="emit('select', ws.id)"
        >
          <GripVertical :size="14" class="shrink-0 text-muted-foreground opacity-[0.55]" />
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ ws.name }}</span>
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="!canRemove"
          :aria-label="removeHint(ws)"
          :title="removeHint(ws)"
          class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-35"
          @click="emit('remove', ws.id)"
        >
          <Trash2 :size="14" />
        </Button>
        <div
          v-if="contextWorkspaceId === ws.id"
          class="absolute left-7 top-full z-30 min-w-32 rounded-md border border-border bg-popover p-1 shadow-md"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
            @click="startRename(ws)"
          >
            <Pencil :size="14" />
            重命名
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
