<script setup lang="ts">
import { computed } from 'vue'
import { GripVertical, Plus, Trash2 } from '@lucide/vue'
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
}>()

const canRemove = computed(() => props.workspaces.length > 1)

function removeHint(workspace: NamedWorkspace): string {
  return canRemove.value ? `删除${workspace.name}` : props.keepOneHint
}
</script>

<template>
  <div class="px-3.5 pb-[18px] mb-1 border-b border-border">
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
        class="group flex items-center gap-1 w-full min-h-[38px] rounded-md transition-colors duration-150"
      >
        <button
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
      </div>
    </div>
  </div>
</template>
