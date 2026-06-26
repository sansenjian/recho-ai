<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
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
    class="gallery-stage relative flex-1 min-w-0 overflow-y-auto bg-secondary py-[26px] px-[clamp(18px,3vw,42px)] max-md:p-3 max-[460px]:p-2"
    @scroll.passive="handleScroll"
  >
    <div class="gallery-header mx-auto mb-5 grid max-w-[1540px] items-start gap-[14px] max-md:flex-col max-md:items-stretch max-md:gap-3">
      <div class="gallery-heading flex min-w-0 flex-wrap items-baseline gap-[10px] max-[460px]:gap-[6px]">
        <span class="text-xs font-extrabold text-muted-foreground">作品广场</span>
        <h2 class="m-0 text-[28px] tracking-normal text-foreground max-[460px]:text-[22px]">生成作品</h2>
        <p class="m-0 text-xs font-extrabold text-muted-foreground">{{ filteredCount }} / {{ sourceCount }}</p>
      </div>
      <div class="gallery-toolbar flex min-w-0 w-full items-center justify-start gap-[10px] max-md:flex-col max-md:items-stretch">
        <div
          class="gallery-filter-group inline-flex gap-[3px] rounded-lg border border-border bg-muted p-[3px] max-md:w-full max-[460px]:grid max-[460px]:grid-cols-3"
          role="tablist"
          aria-label="作品筛选"
        >
          <Button
            v-for="option in filterOptions"
            :key="option.value"
            type="button"
            variant="ghost"
            size="sm"
            :class="[
              'h-[34px] px-3 text-xs font-extrabold max-md:min-h-[42px] max-md:flex-1 max-[460px]:min-w-0',
              filter === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
            ]"
            @click="emit('update:filter', option.value)"
          >
            {{ option.label }}
          </Button>
        </div>
        <label class="gallery-search flex h-[42px] min-w-[220px] flex-[1_1_360px] items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground max-md:h-[42px] max-md:min-w-0 max-md:w-full max-md:flex-none">
          <Search class="h-4 w-4 shrink-0" />
          <input
            :value="query"
            type="search"
            placeholder="搜索提示词、尺寸、参考图"
            class="w-full min-w-0 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            @input="updateQuery"
          >
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="min-h-[34px] px-3 text-xs font-extrabold disabled:opacity-[0.42] disabled:cursor-default max-md:min-h-[42px]"
          :disabled="!hasFilter"
          @click="resetFilters"
        >
          重置
        </Button>
      </div>
    </div>

    <div v-if="images.length" class="gallery-grid mx-auto grid max-w-[1540px] grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-4 max-md:grid-cols-1 max-md:gap-3" aria-live="polite">
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

    <div v-else class="gallery-empty mx-auto grid min-h-[320px] max-w-[720px] place-items-center gap-2 rounded-lg border border-dashed border-border bg-card text-center text-muted-foreground max-md:min-h-[240px] max-[460px]:p-[18px]">
      <strong class="text-lg text-foreground">{{ emptyTitle }}</strong>
      <span v-if="showEmptyHint" class="text-sm">换一个筛选或搜索词</span>
    </div>

    <div v-if="showScrollStatus" class="py-5 pb-1 text-center text-xs font-black text-muted-foreground">
      加载中...
    </div>

    <div v-if="error" class="absolute bottom-[22px] left-1/2 z-24 max-w-[min(560px,calc(100%-64px))] -translate-x-1/2 rounded-lg border border-destructive/20 bg-card px-[14px] py-[10px] text-xs font-bold text-destructive shadow-md">
      {{ error }}
    </div>
  </section>
</template>
