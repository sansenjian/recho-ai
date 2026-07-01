<script setup lang="ts">
import { ExternalLink, Plus, Download, MessageCircle } from '@lucide/vue'
import {
  displayImageUrl,
  displayReferenceUrl,
  formatGalleryDate,
  galleryOptionLabel,
  galleryPrompt,
  galleryReferenceCount,
  galleryReferences,
  type GalleryOption,
} from '../lib/image-gallery'
import type { GeneratedImage, ImageQuality, ImageResolution } from '../types/image'

defineProps<{
  image: GeneratedImage
  resolutionOptions: Array<GalleryOption<ImageResolution>>
  qualityOptions: Array<GalleryOption<ImageQuality>>
  isDownloading: boolean
}>()

const emit = defineEmits<{
  view: []
  useImage: []
  preloadDownload: []
  download: []
  sendToChat: []
}>()
</script>

<template>
  <article class="group grid w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card transition-all duration-200 hover:border-ring/30 hover:shadow-md">
    <button
      type="button"
      class="relative flex w-full aspect-[4/3] items-center justify-center overflow-hidden border-0 border-b border-border p-0 cursor-zoom-in focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      title="查看作品"
      :style="{
        background: 'linear-gradient(45deg, hsl(var(--border) / 0.55) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--border) / 0.55) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--border) / 0.55) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--border) / 0.55) 75%), hsl(var(--muted))',
        backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0',
        backgroundSize: '18px 18px',
      }"
      @click="emit('view')"
    >
      <span class="absolute left-2 top-2 z-[1] inline-flex min-h-6 items-center rounded-md bg-foreground/[0.76] px-2 text-[11px] font-medium text-background backdrop-blur-sm">
        {{ formatGalleryDate(image.timestamp) }}
      </span>
      <span
        v-if="galleryReferenceCount(image)"
        class="absolute right-2 top-2 z-[1] inline-flex min-h-6 items-center rounded-md bg-foreground/[0.76] px-2 text-[11px] font-medium text-background backdrop-blur-sm"
      >
        {{ galleryReferenceCount(image) }} 张参考
      </span>
      <span class="block h-full w-full overflow-hidden">
        <img
          :src="displayImageUrl(image)"
          :alt="galleryPrompt(image)"
          loading="lazy"
          class="block h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
        >
      </span>
    </button>
    <div class="p-2.5 max-[460px]:p-2">
      <p class="m-0 min-h-[38px] overflow-hidden text-[13px] font-semibold leading-[1.45] text-foreground line-clamp-2">
        {{ galleryPrompt(image) }}
      </p>
      <div class="mt-1.5 flex flex-wrap gap-1">
        <span
          v-for="(item, idx) in [image.size || 'auto', galleryOptionLabel(image.resolution, resolutionOptions), galleryOptionLabel(image.quality, qualityOptions)]"
          :key="idx"
          class="max-w-full overflow-hidden whitespace-nowrap rounded-md bg-muted px-[7px] py-0.5 text-[11px] font-medium text-muted-foreground text-ellipsis"
        >
          {{ item }}
        </span>
      </div>
      <div v-if="galleryReferences(image).length" class="mt-1.5 flex gap-1">
        <img
          v-for="reference in galleryReferences(image).slice(0, 3)"
          :key="reference.id || reference.title"
          :src="displayReferenceUrl(reference)"
          :alt="reference.title || '参考图'"
          loading="lazy"
          class="h-6 w-6 rounded border border-border bg-card object-cover"
        >
      </div>
      <div class="mt-2 flex items-center justify-between gap-1">
        <div class="flex gap-1">
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:h-9 max-md:w-9"
            title="查看作品"
            @click="emit('view')"
          >
            <ExternalLink class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:h-9 max-md:w-9"
            title="放入画布"
            @click="emit('useImage')"
          >
            <Plus class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 max-md:h-9 max-md:w-9"
            title="下载原图"
            :disabled="isDownloading"
            @pointerenter="emit('preloadDownload')"
            @focus="emit('preloadDownload')"
            @click="emit('download')"
          >
            <Download class="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:h-9 max-md:w-9"
          title="发送到对话"
          @click="emit('sendToChat')"
        >
          <MessageCircle class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </article>
</template>
