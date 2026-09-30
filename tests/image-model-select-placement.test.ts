// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ImageModelSelect from '../src/components/ImageModelSelect.vue'
import i18n from '../src/i18n'

const OPTIONS = [
  { value: 'gpt-image-2.5', label: 'GPT Image 2.5' },
  { value: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
]

interface Metrics {
  triggerTop: number
  triggerBottom: number
  rootLeft: number
  menuOffsetLeft: number
  menuWidth: number
  viewportWidth: number
  viewportHeight: number
}

let metrics: Metrics = {
  triggerTop: 600,
  triggerBottom: 636,
  rootLeft: 0,
  menuOffsetLeft: 0,
  menuWidth: 300,
  viewportWidth: 1000,
  viewportHeight: 768,
}

function domRect(top: number, bottom: number, left: number, width: number) {
  return {
    top,
    bottom,
    left,
    right: left + width,
    width,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

// jsdom 不做布局,offsetLeft/offsetWidth 恒为 0,所以直接量到原型上。
Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
  configurable: true,
  get: () => metrics.menuOffsetLeft,
})
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get: () => metrics.menuWidth,
})
Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => metrics.viewportWidth })
Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => metrics.viewportHeight })

afterEach(() => {
  vi.unstubAllGlobals()
  metrics = {
    triggerTop: 600,
    triggerBottom: 636,
    rootLeft: 0,
    menuOffsetLeft: 0,
    menuWidth: 300,
    viewportWidth: 1000,
    viewportHeight: 768,
  }
})

async function openMenu() {
  const wrapper = mount(ImageModelSelect, {
    props: { modelValue: 'gpt-image-2.5', defaultModel: 'gpt-image-2.5', options: OPTIONS },
    global: { plugins: [i18n] },
  })

  wrapper.element.getBoundingClientRect = () =>
    domRect(0, 0, metrics.rootLeft, metrics.menuWidth)
  const trigger = wrapper.get<HTMLButtonElement>('.image-model-trigger')
  trigger.element.getBoundingClientRect = () =>
    domRect(metrics.triggerTop, metrics.triggerBottom, metrics.rootLeft, 150)

  await trigger.trigger('click')
  await nextTick()
  await nextTick()

  return { wrapper, trigger, menu: wrapper.get('.image-model-menu') }
}

describe('image model select placement', () => {
  it('opens upward when there is not enough room below', async () => {
    const { menu } = await openMenu()

    expect(menu.attributes('data-side')).toBe('up')
  })

  it('flips downward when the trigger sits near the top of the viewport', async () => {
    metrics = { ...metrics, triggerTop: 40, triggerBottom: 76 }
    const { menu } = await openMenu()

    expect(menu.attributes('data-side')).toBe('down')
  })

  it('caps the menu height at the room left below the trigger', async () => {
    metrics = { ...metrics, triggerTop: 40, triggerBottom: 76, viewportHeight: 300 }
    const { menu } = await openMenu()

    // below = 300 - 76 - 12(gutter) = 212,再减 8(gap)。
    expect((menu.element as HTMLElement).style.getPropertyValue('--image-model-menu-max-height')).toBe('204px')
  })

  it('never lets the menu grow past its own ceiling', async () => {
    const { menu } = await openMenu()

    expect((menu.element as HTMLElement).style.getPropertyValue('--image-model-menu-max-height')).toBe('360px')
  })

  it('pushes the menu back inside the right viewport edge', async () => {
    metrics = { ...metrics, rootLeft: 900 }
    const { menu } = await openMenu()

    // 自然左边界 900,可用右边界 1000 - 300 - 12 = 688,回推 -212。
    expect((menu.element as HTMLElement).style.getPropertyValue('--image-model-menu-shift')).toBe('-212px')
  })

  it('keeps the menu clear of the left viewport edge', async () => {
    metrics = { ...metrics, rootLeft: 4 }
    const { menu } = await openMenu()

    expect((menu.element as HTMLElement).style.getPropertyValue('--image-model-menu-shift')).toBe('8px')
  })

  it('re-measures when the viewport resizes', async () => {
    const { menu } = await openMenu()
    expect(menu.attributes('data-side')).toBe('up')

    metrics = { ...metrics, triggerTop: 40, triggerBottom: 76 }
    window.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(menu.attributes('data-side')).toBe('down')
  })

  it('re-measures when an ancestor scrolls', async () => {
    const { menu } = await openMenu()
    expect(menu.attributes('data-side')).toBe('up')

    metrics = { ...metrics, triggerTop: 40, triggerBottom: 76 }
    window.dispatchEvent(new Event('scroll'))
    await nextTick()

    expect(menu.attributes('data-side')).toBe('down')
  })

  it('observes both the menu and the trigger when ResizeObserver exists', async () => {
    const observed: Element[] = []
    class FakeResizeObserver {
      observe(element: Element) {
        observed.push(element)
      }

      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    const { trigger, menu } = await openMenu()

    expect(observed).toContain(menu.element)
    expect(observed).toContain(trigger.element)
  })

  it('still renders the menu when ResizeObserver is unavailable', async () => {
    vi.stubGlobal('ResizeObserver', undefined)

    const { menu } = await openMenu()

    expect(menu.attributes('data-side')).toBe('up')
    expect(menu.text()).toContain('GPT Image 2.5 Flare')
  })
})
