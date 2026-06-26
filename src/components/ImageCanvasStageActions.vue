<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CanvasNodeType } from '../lib/image-canvas-model'
import { Type, Image, Sparkles, RotateCcw, Upload, Download, Trash2 } from '@lucide/vue'

type CanvasImportMode = 'append' | 'replace'

defineProps<{
  zoomLabel: string
}>()

const emit = defineEmits<{
  'create-node': [type: CanvasNodeType]
  'fit-view': []
  'import-canvas': [event: Event, mode: CanvasImportMode]
  'export-canvas': []
  'clear-canvas': []
}>()

const canvasImportInputRef = ref<HTMLInputElement | null>(null)
let pendingCanvasImportMode: CanvasImportMode = 'append'

function openCanvasImportPicker(event: MouseEvent) {
  pendingCanvasImportMode = event.shiftKey ? 'replace' : 'append'
  if (canvasImportInputRef.value) {
    canvasImportInputRef.value.value = ''
    canvasImportInputRef.value.click()
  }
}

function handleCanvasImport(event: Event) {
  emit('import-canvas', event, pendingCanvasImportMode)
}
</script>

<template>
  <div
    class="non-selectable absolute right-[18px] top-[18px] z-20 flex items-center gap-[7px] rounded-lg border border-border bg-background/95 p-[6px] shadow-sm backdrop-blur-md max-md:left-[10px] max-md:right-auto max-md:top-[10px] max-md:w-max max-md:max-w-[calc(100%-20px)] max-md:flex-nowrap max-md:justify-start max-md:overflow-x-auto"
  >
    <div
      class="hidden max-md:inline-flex max-md:flex-none max-md:gap-[6px] max-md:min-w-0"
      aria-label="创建节点"
    >
      <Button variant="outline" size="sm" class="h-auto min-h-[40px] flex-none gap-[6px] whitespace-nowrap px-[11px] py-0 text-xs font-black" @click="emit('create-node', 'text')">
        <span class="inline-flex h-[18px] w-[18px] items-center justify-center flex-none font-black">
          <Type class="h-4 w-4" />
        </span>
        <span>文本</span>
      </Button>
      <Button variant="outline" size="sm" class="h-auto min-h-[40px] flex-none gap-[6px] whitespace-nowrap px-[11px] py-0 text-xs font-black" @click="emit('create-node', 'image')">
        <span class="inline-flex h-[18px] w-[18px] items-center justify-center flex-none font-black">
          <Image class="h-4 w-4" />
        </span>
        <span>图片</span>
      </Button>
      <Button variant="default" size="sm" class="h-auto min-h-[40px] flex-none gap-[6px] whitespace-nowrap px-[11px] py-0 text-xs font-black" @click="emit('create-node', 'generation')">
        <span class="inline-flex h-[18px] w-[18px] items-center justify-center flex-none font-black">
          <Sparkles class="h-4 w-4" />
        </span>
        <span>生图</span>
      </Button>
    </div>

    <Button variant="ghost" size="icon" type="button" title="复位视图" class="h-[34px] w-[34px] max-md:h-[44px] max-md:w-[44px]" @click="emit('fit-view')">
      <RotateCcw class="h-[18px] w-[18px]" />
    </Button>

    <input
      ref="canvasImportInputRef"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="handleCanvasImport"
    >

    <Button variant="ghost" size="icon" type="button" title="导入画布 JSON，默认追加；按住 Shift 替换" class="h-[34px] w-[34px] max-md:h-[44px] max-md:w-[44px]" @click="openCanvasImportPicker">
      <Upload class="h-[18px] w-[18px]" />
    </Button>

    <Button variant="ghost" size="icon" type="button" title="导出画布 JSON" class="h-[34px] w-[34px] max-md:h-[44px] max-md:w-[44px]" @click="emit('export-canvas')">
      <Download class="h-[18px] w-[18px]" />
    </Button>

    <Button variant="ghost" size="icon" type="button" title="清空画布" class="h-[34px] w-[34px] hover:text-destructive max-md:h-[44px] max-md:w-[44px]" @click="emit('clear-canvas')">
      <Trash2 class="h-[18px] w-[18px]" />
    </Button>

    <Badge variant="default" class="h-6 min-w-[36px] items-center justify-center rounded-md border-0 px-[7px] text-xs font-black max-md:h-[44px] max-md:min-w-[44px] max-md:px-2">
      {{ zoomLabel }}
    </Badge>
  </div>
</template>
