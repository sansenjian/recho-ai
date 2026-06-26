<script setup lang="ts">
import { Button } from '@/components/ui/button'
import type { CanvasNodeType } from '../lib/image-canvas-model'
import { Pencil, Copy, Trash2, Type, Image, Sparkles } from '@lucide/vue'

defineProps<{
  x: number
  y: number
  hasNode: boolean
}>()

const emit = defineEmits<{
  rename: []
  duplicate: []
  delete: []
  'create-node': [type: CanvasNodeType]
}>()
</script>

<template>
  <div
    class="non-selectable absolute left-0 top-0 z-30 w-[176px] rounded-lg border border-border bg-background/96 p-[6px] shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-md"
    :style="{ transform: `translate(${x}px, ${y}px)` }"
    @click.stop
  >
    <template v-if="hasNode">
      <Button variant="ghost" class="h-auto w-full min-h-[40px] justify-start gap-[9px] px-[9px] py-0 text-[13px] font-extrabold text-foreground" @click="emit('rename')">
        <span class="inline-flex h-[22px] w-[22px] items-center justify-center text-foreground">
          <Pencil class="h-[15px] w-[15px]" />
        </span>
        <span>重命名</span>
      </Button>
      <Button variant="ghost" class="h-auto w-full min-h-[40px] justify-start gap-[9px] px-[9px] py-0 text-[13px] font-extrabold text-foreground" @click="emit('duplicate')">
        <span class="inline-flex h-[22px] w-[22px] items-center justify-center text-foreground">
          <Copy class="h-[15px] w-[15px]" />
        </span>
        <span>复制节点</span>
      </Button>
      <Button variant="ghost" class="h-auto w-full min-h-[40px] justify-start gap-[9px] px-[9px] py-0 text-[13px] font-extrabold text-destructive hover:text-destructive" @click="emit('delete')">
        <span class="inline-flex h-[22px] w-[22px] items-center justify-center text-destructive">
          <Trash2 class="h-[15px] w-[15px]" />
        </span>
        <span>删除</span>
      </Button>
    </template>
    <template v-else>
      <Button variant="ghost" class="h-auto w-full min-h-[40px] justify-start gap-[9px] px-[9px] py-0 text-[13px] font-extrabold text-foreground" @click="emit('create-node', 'text')">
        <span class="inline-flex h-[22px] w-[22px] items-center justify-center text-foreground text-[13px] font-black">T</span>
        <span>文本节点</span>
      </Button>
      <Button variant="ghost" class="h-auto w-full min-h-[40px] justify-start gap-[9px] px-[9px] py-0 text-[13px] font-extrabold text-foreground" @click="emit('create-node', 'image')">
        <span class="inline-flex h-[22px] w-[22px] items-center justify-center text-foreground">
          <Image class="h-[15px] w-[15px]" />
        </span>
        <span>图片节点</span>
      </Button>
      <Button variant="ghost" class="h-auto w-full min-h-[40px] justify-start gap-[9px] px-[9px] py-0 text-[13px] font-extrabold text-foreground" @click="emit('create-node', 'generation')">
        <span class="inline-flex h-[22px] w-[22px] items-center justify-center text-foreground">
          <Sparkles class="h-[15px] w-[15px]" />
        </span>
        <span>生图节点</span>
      </Button>
    </template>
  </div>
</template>
