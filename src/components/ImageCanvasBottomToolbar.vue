<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { MousePointer, Hand, ZoomOut, ZoomIn } from '@lucide/vue'

const props = defineProps<{
  zoom: number
  minZoom: number
  maxZoom: number
  zoomLabel: string
}>()

const emit = defineEmits<{
  'update:zoom': [value: number]
}>()

function setZoom(value: number) {
  emit('update:zoom', Math.min(props.maxZoom, Math.max(props.minZoom, value)))
}

function handleZoomInput(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement) {
    setZoom(Number(event.currentTarget.value))
  }
}
</script>

<template>
  <div
    class="non-selectable absolute left-[22px] bottom-[18px] z-20 flex items-center gap-[7px] rounded-lg border border-border bg-background/95 p-[6px] shadow-sm backdrop-blur-md max-md:bottom-[10px] max-md:left-[10px] max-md:right-[10px] max-md:grid max-md:grid-cols-[44px_44px_1px_44px_minmax(0,1fr)_44px_minmax(42px,auto)] max-md:justify-stretch max-md:p-2 max-[380px]:grid-cols-[38px_38px_1px_38px_minmax(58px,1fr)_38px_minmax(42px,auto)] max-[380px]:gap-[5px]"
  >
    <Button variant="default" size="icon" type="button" title="选择" class="h-[34px] w-[34px] max-md:h-[44px] max-md:w-[44px] max-[380px]:h-[38px] max-[380px]:w-[38px]">
      <MousePointer class="h-[18px] w-[18px]" />
    </Button>
    <Button variant="ghost" size="icon" type="button" title="移动画布" class="h-[34px] w-[34px] max-md:h-[44px] max-md:w-[44px] max-[380px]:h-[38px] max-[380px]:w-[38px]">
      <Hand class="h-[18px] w-[18px]" />
    </Button>
    <Separator orientation="vertical" class="h-[22px] max-md:self-center" />
    <Button variant="ghost" size="icon" type="button" title="缩小" class="h-[34px] w-[34px] max-md:h-[44px] max-md:w-[44px] max-[380px]:h-[38px] max-[380px]:w-[38px]" @click="setZoom(zoom - 0.08)">
      <ZoomOut class="h-[18px] w-[18px]" />
    </Button>
    <input
      type="range"
      :min="minZoom"
      :max="maxZoom"
      :value="zoom"
      step="0.02"
      aria-label="缩放"
      class="w-[92px] accent-primary max-md:h-[34px] max-md:w-full max-md:min-w-0"
      @input="handleZoomInput"
    >
    <Button variant="ghost" size="icon" type="button" title="放大" class="h-[34px] w-[34px] max-md:h-[44px] max-md:w-[44px] max-[380px]:h-[38px] max-[380px]:w-[38px]" @click="setZoom(zoom + 0.08)">
      <ZoomIn class="h-[18px] w-[18px]" />
    </Button>
    <Badge variant="default" class="h-6 min-w-[36px] items-center justify-center rounded-md border-0 px-[7px] text-xs font-black max-md:h-[44px] max-md:min-w-[44px] max-md:px-2 max-[380px]:h-[38px]">
      {{ zoomLabel }}
    </Badge>
  </div>
</template>
