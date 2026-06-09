import { computed, ref, watch, type Ref } from 'vue'
import { GALLERY_PAGE_SIZE, type GalleryFilter } from '../lib/image-canvas-model'
import { galleryPrompt, galleryReferenceCount, galleryReferences } from '../lib/image-gallery'
import type { GeneratedImage, ImageHistoryScope } from '../types/image'

export interface UseImageGalleryStageOptions {
  generatedImages: Ref<GeneratedImage[]>
  publicGalleryImages: Ref<GeneratedImage[]>
  isLoadingHistory: Ref<boolean>
  hasMoreHistory: Ref<boolean>
  isLoadingGallery: Ref<boolean>
  hasMoreGallery: Ref<boolean>
  ensureGalleryLoaded: () => Promise<void>
  loadMoreHistory: () => Promise<void>
  loadMoreGalleryHistory: () => Promise<void>
}

export function useImageGalleryStage(options: UseImageGalleryStageOptions) {
  const query = ref('')
  const filter = ref<GalleryFilter>('mine')
  const isAutoLoading = ref(false)
  const visibleCount = ref(GALLERY_PAGE_SIZE)

  const isPublicFilter = computed(() => filter.value !== 'mine')
  const actionScope = computed<ImageHistoryScope>(() => isPublicFilter.value ? 'public' : 'mine')
  const sourceImages = computed(() => isPublicFilter.value ? options.publicGalleryImages.value : options.generatedImages.value)
  const hasFilter = computed(() => filter.value !== 'mine' || Boolean(query.value.trim()))
  const isLoading = computed(() => isPublicFilter.value ? options.isLoadingGallery.value : options.isLoadingHistory.value)
  const isLoadingMore = computed(() => isAutoLoading.value || isLoading.value)

  const filterOptions: Array<{ value: GalleryFilter; label: string }> = [
    { value: 'mine', label: '我的' },
    { value: 'references', label: '参考图' },
    { value: 'latest', label: '最新' },
  ]

  const filteredImages = computed(() => {
    const normalizedQuery = query.value.trim().toLowerCase()

    return sourceImages.value.filter((image) => {
      if (filter.value === 'references' && !galleryReferenceCount(image)) return false
      if (!normalizedQuery) return true

      const searchable = [
        galleryPrompt(image),
        image.size,
        image.aspectRatio,
        image.resolution,
        image.quality,
        ...galleryReferences(image).map(reference => `${reference.title} ${reference.fileName ?? ''}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchable.includes(normalizedQuery)
    })
  })

  const visibleImages = computed(() => filteredImages.value.slice(0, visibleCount.value))
  const canLoadMore = computed(() => (
    visibleCount.value < filteredImages.value.length ||
    (isPublicFilter.value ? options.hasMoreGallery.value : options.hasMoreHistory.value)
  ))

  watch([query, filter], () => {
    visibleCount.value = GALLERY_PAGE_SIZE
    if (isPublicFilter.value) {
      void options.ensureGalleryLoaded()
    }
  })

  async function loadMore() {
    if (!canLoadMore.value || isAutoLoading.value || isLoading.value) return

    isAutoLoading.value = true
    try {
      if (isPublicFilter.value) {
        await options.ensureGalleryLoaded()
      }

      const localCount = filteredImages.value.length
      if (visibleCount.value < localCount) {
        visibleCount.value = Math.min(visibleCount.value + GALLERY_PAGE_SIZE, localCount)
        return
      }

      if (isPublicFilter.value) {
        if (!options.hasMoreGallery.value) return
        await options.loadMoreGalleryHistory()
      } else {
        if (!options.hasMoreHistory.value) return
        await options.loadMoreHistory()
      }

      const updatedCount = filteredImages.value.length
      if (updatedCount > visibleCount.value) {
        visibleCount.value = Math.min(visibleCount.value + GALLERY_PAGE_SIZE, updatedCount)
      }
    } finally {
      isAutoLoading.value = false
    }
  }

  return {
    query,
    filter,
    filterOptions,
    isPublicFilter,
    actionScope,
    sourceImages,
    filteredImages,
    visibleImages,
    hasFilter,
    isLoading,
    isLoadingMore,
    loadMore,
  }
}
