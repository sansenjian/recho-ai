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
    class="gallery-stage"
    @scroll.passive="handleScroll"
  >
    <div class="gallery-header">
      <div class="gallery-heading">
        <span class="gallery-eyebrow">作品广场</span>
        <h2>生成作品</h2>
        <p>{{ filteredCount }} / {{ sourceCount }}</p>
      </div>
      <div class="gallery-toolbar">
        <div class="gallery-filter-group" role="tablist" aria-label="作品筛选">
          <button
            v-for="option in filterOptions"
            :key="option.value"
            type="button"
            :class="{ active: filter === option.value }"
            @click="emit('update:filter', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <label class="gallery-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 4 4" />
          </svg>
          <input :value="query" type="search" placeholder="搜索提示词、尺寸、参考图" @input="updateQuery">
        </label>
        <button
          type="button"
          class="gallery-reset"
          :disabled="!hasFilter"
          @click="resetFilters"
        >
          重置
        </button>
      </div>
    </div>

    <div v-if="images.length" class="gallery-grid" aria-live="polite">
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

    <div v-else class="gallery-empty">
      <strong>{{ emptyTitle }}</strong>
      <span v-if="showEmptyHint">换一个筛选或搜索词</span>
    </div>

    <div v-if="showScrollStatus" class="gallery-scroll-status">
      加载中...
    </div>

    <div v-if="error" class="global-error">{{ error }}</div>
  </section>
</template>

<style scoped>
.gallery-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 26px clamp(18px, 3vw, 42px);
  overflow-y: auto;
  background: hsl(var(--secondary));
}

.gallery-header {
  display: grid;
  align-items: start;
  gap: 14px;
  margin: 0 auto 20px;
  max-width: 1540px;
}

.gallery-header button:disabled {
  opacity: 0.42;
  cursor: default;
}

.gallery-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.gallery-eyebrow {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 800;
}

.gallery-header h2 {
  margin: 0;
  color: hsl(var(--foreground));
  font-size: 28px;
  letter-spacing: 0;
}

.gallery-header p {
  margin: 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 800;
}

.gallery-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  gap: 10px;
  min-width: 0;
}

.gallery-filter-group {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--muted));
}

.gallery-filter-group button,
.gallery-reset {
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: var(--radius-md, 7px);
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.gallery-filter-group button {
  padding: 0 12px;
  color: hsl(var(--muted-foreground));
}

.gallery-filter-group button.active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  box-shadow: var(--shadow-sm);
}

.gallery-search {
  display: flex;
  align-items: center;
  min-width: 220px;
  height: 42px;
  flex: 1 1 360px;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
}

.gallery-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: hsl(var(--foreground));
  font: inherit;
  font-size: 13px;
}

.gallery-search input::placeholder {
  color: hsl(var(--muted-foreground));
}

.gallery-reset {
  padding: 0 12px;
  border-color: hsl(var(--border));
}

.gallery-reset:disabled {
  opacity: 0.42;
  pointer-events: none;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  align-items: start;
  gap: 16px;
  max-width: 1540px;
  margin: 0 auto;
}

.gallery-scroll-status {
  padding: 20px 0 4px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.gallery-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 320px;
  max-width: 720px;
  margin: 0 auto;
  border: 1px dashed hsl(var(--border));
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  text-align: center;
}

.gallery-empty strong {
  color: hsl(var(--foreground));
  font-size: 18px;
}

.gallery-empty span {
  font-size: 13px;
}

.global-error {
  position: absolute;
  left: 50%;
  bottom: 22px;
  z-index: 24;
  max-width: min(560px, calc(100% - 64px));
  padding: 10px 14px;
  border: 1px solid hsl(var(--destructive) / 0.2);
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--card));
  color: hsl(var(--destructive));
  font-size: 12px;
  font-weight: 700;
  box-shadow: var(--shadow-md);
  transform: translateX(-50%);
}

@media (max-width: 760px) {
  .gallery-stage {
    padding: 12px;
  }

  .gallery-header {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }

  .gallery-toolbar {
    align-items: stretch;
    flex-direction: column;
    min-width: 0;
  }

  .gallery-filter-group {
    width: 100%;
  }

  .gallery-filter-group button {
    flex: 1;
    min-height: 42px;
  }

  .gallery-search {
    width: 100%;
    min-width: 0;
    height: 42px;
    flex: 0 0 auto;
  }

  .gallery-reset {
    min-height: 42px;
  }

  .gallery-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}

@media (max-width: 460px) {
  .gallery-stage {
    padding: 8px;
  }

  .gallery-header {
    margin-bottom: 12px;
  }

  .gallery-heading {
    gap: 6px;
  }

  .gallery-header h2 {
    font-size: 22px;
  }

  .gallery-filter-group {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .gallery-filter-group button,
  .gallery-reset {
    min-width: 0;
  }

  .gallery-empty {
    min-height: 240px;
    padding: 18px;
  }
}
</style>
