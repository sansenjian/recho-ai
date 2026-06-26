<script setup lang="ts">
import type { AgentModeOption } from '../types'
import type { ToolCall } from '../types/tools'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

defineProps<{
  modes: AgentModeOption[]
  activeMode: AgentModeOption
  skills: Array<{ name: string; description: string; icon: string }>
  activeSkill: string | null
  activeToolCalls: ToolCall[]
  completedToolCalls: ToolCall[]
}>()

defineEmits<{
  changeMode: [mode: AgentModeOption]
  selectSkill: [name: string | null]
}>()
</script>

<template>
  <aside class="hidden w-80 shrink-0 overflow-y-auto bg-background p-3.5 shadow-[inset_-1px_0_0_0_hsl(var(--border))] xl:block">
    <section class="border-b border-border py-3 first:pt-0 last:border-b-0">
      <div class="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Mode</div>
      <div class="grid grid-cols-3 gap-1.5">
        <Button
          v-for="mode in modes"
          :key="mode.id"
          variant="ghost"
          class="h-auto min-h-[70px] flex-col items-start justify-start gap-0.5 rounded-md p-2 text-left font-normal ring-1 ring-border transition-colors hover:bg-muted"
          :class="{ 'bg-green-50 ring-green-500 dark:bg-green-950/20': mode.id === activeMode.id }"
          @click="$emit('changeMode', mode)"
        >
          <span class="block text-[13px] font-semibold text-foreground">{{ mode.label }}</span>
          <span class="block text-[11px] leading-snug text-muted-foreground">{{ mode.hint }}</span>
        </Button>
      </div>
    </section>

    <section class="border-b border-border py-3 first:pt-0 last:border-b-0">
      <div class="mb-2 flex items-center justify-between">
        <span class="block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Skills</span>
        <Button
          v-if="activeSkill"
          variant="ghost"
          size="sm"
          class="h-auto rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border hover:bg-muted"
          @click="$emit('selectSkill', null)"
        >
          Clear
        </Button>
      </div>
      <div class="flex flex-col gap-[5px]">
        <Button
          v-for="skill in skills"
          :key="skill.name"
          variant="ghost"
          class="h-auto justify-start gap-0 rounded-md px-2 py-[7px] text-left font-normal ring-1 ring-border transition-colors hover:bg-muted"
          :class="{ 'bg-green-50 ring-green-500 dark:bg-green-950/20': skill.name === activeSkill }"
          @click="$emit('selectSkill', skill.name)"
        >
          <span class="block text-[13px] font-semibold text-foreground">/{{ skill.name }}</span>
          <span class="block text-[11px] leading-snug text-muted-foreground">{{ skill.description }}</span>
        </Button>
        <div v-if="skills.length === 0" class="text-[11px] leading-snug text-muted-foreground">Gateway skills not loaded</div>
      </div>
    </section>

    <section class="border-b border-border py-3 first:pt-0 last:border-b-0">
      <div class="mb-2 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Tool Stream</div>
      <div class="flex flex-col gap-[5px]">
        <div v-for="tool in activeToolCalls" :key="tool.id" class="flex grid-cols-[16px_1fr_auto] items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 ring-1 ring-border">
          <span class="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-green-600" />
          <span class="min-w-0 truncate font-mono text-xs text-foreground">{{ tool.name }}</span>
          <Badge variant="secondary" class="h-auto px-1.5 py-px text-[10px]">running</Badge>
        </div>
        <div v-for="tool in completedToolCalls.slice(-4)" :key="tool.id" class="flex grid-cols-[16px_1fr_auto] items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 ring-1 ring-border">
          <span class="shrink-0 text-[13px] text-green-600">✓</span>
          <span class="min-w-0 truncate font-mono text-xs text-foreground">{{ tool.name }}</span>
          <Badge variant="outline" class="h-auto px-1.5 py-px text-[10px]">done</Badge>
        </div>
        <div v-if="activeToolCalls.length === 0 && completedToolCalls.length === 0" class="text-[11px] leading-snug text-muted-foreground">No tool calls yet</div>
      </div>
    </section>
  </aside>
</template>
