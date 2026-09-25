// @vitest-environment jsdom
import { nextTick, ref } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImageCanvas from '../src/components/ImageCanvas.vue'
import ImagioSidebar from '../src/components/ImagioSidebar.vue'
import ImagioView from '../src/components/ImagioView.vue'
import type { GeneratedImage } from '../src/types/image'

const images = ref<GeneratedImage[]>([])
const generate = vi.fn()

vi.mock('../src/composables/useImageGen', () => ({
  useImageGen: () => ({
    generatedImages: images,
    galleryImages: ref([]),
    isGenerating: ref(false), isLoadingHistory: ref(false), hasMoreHistory: ref(false),
    isLoadingGallery: ref(false), hasMoreGallery: ref(false), galleryLoaded: ref(false),
    galleryError: ref(null), error: ref(null),
    generate, clearHistory: vi.fn(), loadMoreHistory: vi.fn(),
    ensureGalleryLoaded: vi.fn(), loadMoreGalleryHistory: vi.fn(), retryGalleryHistory: vi.fn(),
    resolveImageDetail: vi.fn(),
  }),
}))

function image(id: string): GeneratedImage {
  return { id, prompt: id, size: 'auto', timestamp: '2026-01-01', url: `https://example.com/${id}` }
}

describe('Imagio conversation workspaces', () => {
  beforeEach(() => {
    localStorage.clear()
    images.value = [image('legacy')]
    generate.mockReset()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  it('isolates generated images across workspaces, refreshes and deletion', async () => {
    const wrapper = shallowMount(ImageCanvas, { props: { workspaceMode: 'canvas', imageMode: 'imagio' } })
    const sidebar = () => wrapper.findComponent(ImagioSidebar)
    const view = () => wrapper.findComponent(ImagioView)
    const defaultId = sidebar().props('activeWorkspaceId') as string
    expect(view().props('generatedImages').map((item: GeneratedImage) => item.id)).toEqual(['legacy'])

    sidebar().vm.$emit('create-workspace')
    await nextTick()
    const newId = sidebar().props('activeWorkspaceId') as string
    expect(newId).not.toBe(defaultId)
    expect(view().props('generatedImages')).toEqual([])

    let finishGeneration!: (value: GeneratedImage[]) => void
    generate.mockImplementationOnce(() => new Promise(resolve => { finishGeneration = resolve }))
    const pending = (view().props('generate') as typeof generate)('new prompt')
    sidebar().vm.$emit('select-workspace', defaultId)
    await nextTick()
    finishGeneration([image('new')])
    images.value = [image('new'), image('legacy')]
    await pending
    await nextTick()
    expect(view().props('generatedImages').map((item: GeneratedImage) => item.id)).toEqual(['legacy'])

    sidebar().vm.$emit('select-workspace', newId)
    await nextTick()
    expect(view().props('generatedImages').map((item: GeneratedImage) => item.id)).toEqual(['new'])
    wrapper.unmount()

    const restored = shallowMount(ImageCanvas, { props: { workspaceMode: 'canvas', imageMode: 'imagio' } })
    expect(restored.findComponent(ImagioSidebar).props('activeWorkspaceId')).toBe(newId)
    expect(restored.findComponent(ImagioView).props('generatedImages').map((item: GeneratedImage) => item.id)).toEqual(['new'])
    restored.findComponent(ImagioSidebar).vm.$emit('remove-workspace', newId)
    await nextTick()
    expect(restored.findComponent(ImagioView).props('generatedImages').map((item: GeneratedImage) => item.id)).toEqual(['new', 'legacy'])
    restored.findComponent(ImagioSidebar).vm.$emit('clear-history')
    await nextTick()
    expect(restored.findComponent(ImagioView).props('generatedImages')).toEqual([])
    restored.unmount()
  })
})
