<script setup lang="ts">
import { ExternalLink, Plus, Download, MessageCircle } from '@lucide/vue'
import { Button } from '@/components/ui/button'
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
  <article class="grid w-full min-w-0 overflow-hidden border border-border rounded-lg bg-card shadow-sm">
    <button
      type="button"
      class="relative flex items-center justify-center w-full aspect-[4/3] p-0 border-0 border-b border-border cursor-zoom-in overflow-hidden focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      title="查看作品"
      :style="{
        background: 'linear-gradient(45deg, hsl(var(--border) / 0.55) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--border) / 0.55) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--border) / 0.55) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--border) / 0.55) 75%), hsl(var(--muted))',
        backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0',
        backgroundSize: '18px 18px',
      }"
      @click="emit('view')"
    >
      <span
        class="absolute z-[1] top-2.5 left-2.5 inline-flex items-center min-h-6 px-2 border border-border/[0.45] rounded-md bg-foreground/[0.76] text-background text-[11px] font-black backdrop-blur-sm"
      >
        {{ formatGalleryDate(image.timestamp) }}
      </span>
      <span
        v-if="galleryReferenceCount(image)"
        class="absolute z-[1] top-2.5 right-2.5 inline-flex items-center min-h-6 px-2 border border-border/[0.45] rounded-md bg-foreground/[0.76] text-background text-[11px] font-black backdrop-blur-sm"
      >
        {{ galleryReferenceCount(image) }} 张参考
      </span>
      <span class="block w-full h-full">
        <img
          :src="displayImageUrl(image)"
          :alt="galleryPrompt(image)"
          loading="lazy"
          class="block w-full h-full object-cover object-center"
        >
      </span>
    </button>
    <div class="grid gap-2.5 p-3 max-[460px]:p-2.5">
      <p class="min-h-[38px] m-0 overflow-hidden text-foreground text-[13px] font-extrabold leading-[1.46] line-clamp-2">
        {{ galleryPrompt(image) }}
      </p>
      <div class="flex min-w-0 flex-wrap gap-[5px] text-muted-foreground text-[11px] font-extrabold">
        <span
          v-for="(item, idx) in [image.size || 'auto', galleryOptionLabel(image.resolution, resolutionOptions), galleryOptionLabel(image.quality, qualityOptions)]"
          :key="idx"
          class="max-w-full px-[7px] py-[3px] rounded-md bg-muted overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {{ item }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-2.5 max-[460px]:items-stretch max-[460px]:flex-col">
        <div class="flex min-w-0 h-[30px] max-[460px]:h-7" aria-label="参考图">
          <img
            v-for="reference in galleryReferences(image).slice(0, 3)"
            :key="reference.id || reference.title"
            :src="displayReferenceUrl(reference)"
            :alt="reference.title || '参考图'"
            loading="lazy"
            class="w-[30px] h-[30px] -mr-[7px] border-2 border-card rounded-md bg-card object-cover shadow-sm last:mr-0 max-[460px]:w-7 max-[460px]:h-7"
          >
        </div>
        <div class="flex flex-[0_0_auto] gap-[5px] max-md:flex-1 max-md:gap-2">
          <Button
            variant="outline"
            size="icon"
            class="w-8 min-h-8 p-0 text-muted-foreground hover:text-foreground rounded-md border-border bg-background hover:bg-accent hover:border-ring disabled:opacity-[0.46] disabled:cursor-not-allowed max-md:flex-1 max-md:min-h-11"
            title="查看作品"
            @click="emit('view')"
          >
            <ExternalLink class="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="w-8 min-h-8 p-0 text-muted-foreground hover:text-foreground rounded-md border-border bg-background hover:bg-accent hover:border-ring max-md:flex-1 max-md:min-h-11"
            title="放入画布"
            @click="emit('useImage')"
          >
            <Plus class="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="w-8 min-h-8 p-0 text-muted-foreground hover:text-foreground rounded-md border-border bg-background hover:bg-accent hover:border-ring disabled:opacity-[0.46] disabled:cursor-not-allowed max-md:flex-1 max-md:min-h-11"
            title="下载原图"
            :disabled="isDownloading"
            @pointerenter="emit('preloadDownload')"
            @focus="emit('preloadDownload')"
            @click="emit('download')"
          >
            <Download class="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="w-8 min-h-8 p-0 text-muted-foreground hover:text-foreground rounded-md border-border bg-background hover:bg-accent hover:border-ring max-md:flex-1 max-md:min-h-11"
            title="发送到对话"
            @click="emit('sendToChat')"
          >
            <MessageCircle class="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  </article>
</template>
