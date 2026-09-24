// @vitest-environment jsdom
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImageCanvas from '../src/components/ImageCanvas.vue'
import ImageModelSelect from '../src/components/ImageModelSelect.vue'
import { resetAppConfigForTests } from '../src/composables/useAppConfig'

describe('ImageCanvas model selector', () => {
  afterEach(() => {
    resetAppConfigForTests()
    vi.unstubAllGlobals()
  })

  it('renders the configured models in the desktop settings panel', async () => {
    resetAppConfigForTests()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      availableImageModels: [
        { id: 'image-default', name: 'Default image model' },
        { id: 'image-next', name: 'Next image model' },
      ],
      defaultImageModel: 'image-default',
    }), { status: 200 })))

    const wrapper = shallowMount(ImageCanvas, {
      props: { workspaceMode: 'canvas', imageMode: 'imagio' },
      global: { stubs: { ImageModelSelect: false } },
    })
    await flushPromises()

    const selector = wrapper.findComponent(ImageModelSelect)
    expect(selector.exists()).toBe(true)
    expect(selector.get('.image-model-trigger').text()).toContain('Default image model')
    await selector.get('.image-model-trigger').trigger('click')
    expect(selector.get('[role="listbox"]').text()).toContain('Next image model')

    wrapper.unmount()
  })
})
