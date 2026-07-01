<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  GALLERY_AUTO_LOAD_PROGRESS,
  type GalleryFilter,
  type NodeQuality,
  type NodeResolution,
} from '../lib/image-canvas-model'
import type { GalleryOption } from '../lib/image-gallery'
import type { GeneratedImage } from '../types/image'
import ImageGalleryCard from './ImageGalleryCard.vue'
import { Search } from '@lucide/vue'

const props = defineProps<{
  images: GeneratedImage[]
  filteredCount: number
  sourceCount: number
  query: string
  filter: GalleryFilter
  filterOptions: Array<{ value: GalleryFilter; label: string }>
  hasFilter: boolean
  isPublicFilter: boolean
  galleryLoaded: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: string | null
  resolutionOptions: Array<GalleryOption<NodeResolution>>
  qualityOptions: Array<GalleryOption<NodeQuality>>
  isImageDownloading: (image: GeneratedImage) => boolean
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:filter': [value: GalleryFilter]
  'load-more': []
  view: [image: GeneratedImage]
  'use-image': [image: GeneratedImage]
  'preload-download': [image: GeneratedImage]
  download: [image: GeneratedImage]
  'send-to-chat': [image: GeneratedImage]
}>()

const stageRef = ref<HTMLElement | null>(null)

const emptyTitle = computed(() => {
  const initialLoading = props.isPublicFilter
    ? !props.galleryLoaded && props.isLoading
    : props.isLoading

  if (initialLoading) return '正在加载作品'
  return props.sourceCount ? '没有匹配作品' : '暂无作品'
})

const showEmptyHint = computed(() => props.hasFilter && (!props.isPublicFilter || props.galleryLoaded))
const showScrollStatus = computed(() => props.images.length > 0 && props.isLoadingMore)

watch(
  () => [props.query, props.filter],
  () => {
    void nextTick(() => {
      stageRef.value?.scrollTo({ top: 0 })
    })
  },
)

function updateQuery(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement) {
    emit('update:query', event.currentTarget.value)
  }
}

function resetFilters() {
  emit('update:query', '')
  emit('update:filter', 'mine')
}

function handleScroll(event: Event) {
  const stage = event.currentTarget as HTMLElement | null
  if (!stage) return

  const scrollableHeight = stage.scrollHeight - stage.clientHeight
  if (scrollableHeight <= 0) return

  const scrollProgress = stage.scrollTop / scrollableHeight
  if (scrollProgress >= GALLERY_AUTO_LOAD_PROGRESS) {
    emit('load-more')
  }
}
</script>

<template>
  <section
    ref="stageRef"
    class="gallery-stage relative flex-1 min-w-0 w-full overflow-y-auto bg-secondary px-6 pt-6 max-md:px-4 max-[460px]:px-3"
    @scroll.passive="handleScroll"
  >
    <!-- Header -->
    <div class="mx-auto max-w-[1440px] pb-4">
      <div class="flex items-baseline gap-2">
        <span class="text-xs font-medium text-muted-foreground">作品广场</span>
        <h2 class="m-0 text-2xl font-semibold tracking-normal text-foreground">生成作品</h2>
        <span class="ml-1 text-xs font-medium text-muted-foreground">{{ filteredCount }} / {{ sourceCount }}</span>
      </div>
      <div class="mt-3 flex items-center gap-3 max-md:flex-wrap">
        <!-- Filter Group -->
        <div
          class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted p-1"
          role="tablist"
          aria-label="作品筛选"
        >
          <button
            v-for="option in filterOptions"
            :key="option.value"
            type="button"
            :class="[
              'rounded-[calc(var(--radius)-2px)] border-0 px-3.5 py-1 text-[13px] font-medium transition-colors cursor-pointer max-md:py-1.5',
              filter === option.value
                ? 'bg-background text-foreground shadow-sm'
                : 'bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
            ]"
            @click="emit('update:filter', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <!-- Search -->
        <div class="relative min-w-[280px] flex-1 max-md:min-w-0 max-md:w-full">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            :value="query"
            type="search"
            placeholder="搜索提示词、尺寸、参考图"
            class="h-[34px] w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[13px] font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring max-md:h-[38px]"
            @input="updateQuery"
          >
        </div>
        <!-- Reset -->
        <button
          type="button"
          :class="[
            'shrink-0 rounded-lg border border-border px-3.5 py-1 text-[13px] font-medium transition-colors max-md:h-[38px] max-md:px-3',
            hasFilter
              ? 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer'
              : 'bg-transparent text-muted-foreground opacity-50 cursor-default',
          ]"
          :disabled="!hasFilter"
          @click="resetFilters"
        >
          重置
        </button>
      </div>
    </div>

    <!-- Gallery Grid -->
    <div v-if="images.length" class="mx-auto max-w-[1440px] pb-8" aria-live="polite">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-md:gap-2.5">
        <ImageGalleryCard
          v-for="image in images"
          :key="image.id"
          :image="image"
          :resolution-options="resolutionOptions"
          :quality-options="qualityOptions"
          :is-downloading="isImageDownloading(image)"
          @view="emit('view', image)"
          @use-image="emit('use-image', image)"
          @preload-download="emit('preload-download', image)"
          @download="emit('download', image)"
          @send-to-chat="emit('send-to-chat', image)"
        />
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="mx-auto max-w-[1440px] pb-8">
      <div class="grid w-full min-h-[320px] place-items-center gap-2 rounded-lg border border-dashed border-foreground/8 bg-card text-center text-muted-foreground max-md:min-h-[240px] max-[460px]:p-[18px]">
        <strong class="text-lg font-semibold text-foreground">{{ emptyTitle }}</strong>
        <span v-if="showEmptyHint" class="text-sm">换一个筛选或搜索词</span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="showScrollStatus" class="py-5 pb-1 text-center text-xs font-medium text-muted-foreground">
      加载中...
    </div>

    <!-- Error -->
    <div v-if="error" class="absolute bottom-[22px] left-1/2 z-24 max-w-[min(560px,calc(100%-64px))] -translate-x-1/2 rounded-lg border border-destructive/20 bg-card px-3.5 py-2.5 text-xs font-medium text-destructive shadow-md">
      {{ error }}
    </div>
  </section>
</template>
