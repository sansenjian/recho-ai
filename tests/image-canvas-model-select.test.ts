// @vitest-environment jsdom
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImageCanvas from '../src/components/ImageCanvas.vue'
import ImagioView from '../src/components/ImagioView.vue'
import ImageModelSelect from '../src/components/ImageModelSelect.vue'
import { resetAppConfigForTests } from '../src/composables/useAppConfig'

describe('ImageCanvas model selector', () => {
  afterEach(() => {
    resetAppConfigForTests()
    vi.unstubAllGlobals()
  })

  it('renders the configured models beside Generate, not in the settings sidebar', async () => {
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
      global: { stubs: { ImagioView: false, ImageModelSelect: false } },
    })
    await flushPromises()

    const selector = wrapper.findComponent(ImageModelSelect)
    expect(selector.exists()).toBe(true)
    expect(wrapper.find('aside .image-model-trigger').exists()).toBe(false)
    expect(wrapper.findComponent(ImagioView).get('.prompt-actions-end').findComponent(ImageModelSelect).exists()).toBe(true)
    expect(selector.get('.image-model-trigger').text()).toContain('Default image model')
    await selector.get('.image-model-trigger').trigger('click')
    expect(selector.get('[role="listbox"]').text()).toContain('Next image model')

    wrapper.unmount()
  })

  it('keeps the default image model selectable while app config is still loading', async () => {
    resetAppConfigForTests()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    let resolveConfig!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveConfig = resolve
    })))

    const wrapper = shallowMount(ImageCanvas, {
      props: { workspaceMode: 'canvas', imageMode: 'imagio' },
      global: { stubs: { ImagioView: false, ImageModelSelect: false } },
    })

    const selector = wrapper.findComponent(ImageModelSelect)
    const trigger = selector.get('.image-model-trigger')
    expect((trigger.element as HTMLButtonElement).disabled).toBe(false)
    expect(trigger.text()).toContain('gpt-image-2')
    await trigger.trigger('click')
    expect(selector.find('[role="option"]').text()).toContain('gpt-image-2')

    resolveConfig(new Response(JSON.stringify({
      availableImageModels: [
        { id: 'recommended-image', name: 'Recommended image', supportsTransparent: true },
      ],
      defaultImageModel: 'recommended-image',
    }), { status: 200 }))
    await flushPromises()

    expect(selector.get('.image-model-trigger').text()).toContain('Recommended image')
    expect(selector.findAll('[role="option"]').map(option => option.text())).toContain('Recommended image')
    wrapper.unmount()
  })

  it('adds the configured default when the server returns an empty model catalog', async () => {
    resetAppConfigForTests()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      availableImageModels: [],
      defaultImageModel: 'server-image-default',
    }), { status: 200 })))

    const wrapper = shallowMount(ImageCanvas, {
      props: { workspaceMode: 'canvas', imageMode: 'imagio' },
      global: { stubs: { ImagioView: false, ImageModelSelect: false } },
    })
    await flushPromises()

    const selector = wrapper.findComponent(ImageModelSelect)
    const trigger = selector.get('.image-model-trigger')
    expect((trigger.element as HTMLButtonElement).disabled).toBe(false)
    expect(trigger.text()).toContain('server-image-default')
    await trigger.trigger('click')
    expect(selector.findAll('[role="option"]').map(option => option.text())).toContain('server-image-default')

    wrapper.unmount()
  })

  it('preserves an actively selected fallback model when the server default changes', async () => {
    resetAppConfigForTests()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    let resolveConfig!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveConfig = resolve
    })))

    const wrapper = shallowMount(ImageCanvas, {
      props: { workspaceMode: 'canvas', imageMode: 'imagio' },
      global: { stubs: { ImagioView: false, ImageModelSelect: false } },
    })

    const selector = wrapper.findComponent(ImageModelSelect)
    await selector.get('.image-model-trigger').trigger('click')
    await selector.get('[role="option"]').trigger('click')

    resolveConfig(new Response(JSON.stringify({
      availableImageModels: [
        { id: 'recommended-image', name: 'Recommended image' },
      ],
      defaultImageModel: 'recommended-image',
    }), { status: 200 }))
    await flushPromises()

    expect(selector.get('.image-model-trigger').text()).toContain('gpt-image-2')
    wrapper.unmount()
  })
})
