// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useReducedMotion } from '../src/composables/useReducedMotion'

// jsdom 不实现 matchMedia,所以每个用例都自己造一个可切换的 MediaQueryList。
function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: initialMatches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => true,
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    emit(matches: boolean) {
      query.matches = matches
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent)
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

function mountProbe() {
  let reduced!: { value: boolean }
  const Probe = defineComponent({
    setup() {
      reduced = useReducedMotion()
      return () => h('div')
    },
  })
  const wrapper = mount(Probe)
  return { wrapper, reduced: () => reduced.value }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReducedMotion', () => {
  it('starts from the media query result', () => {
    stubMatchMedia(true)

    const { reduced } = mountProbe()

    expect(reduced()).toBe(true)
  })

  it('reports false when the user has no motion preference set', () => {
    stubMatchMedia(false)

    const { reduced } = mountProbe()

    expect(reduced()).toBe(false)
  })

  it('follows the query when the preference changes mid-session', async () => {
    const media = stubMatchMedia(false)
    const { reduced } = mountProbe()
    expect(reduced()).toBe(false)

    media.emit(true)
    expect(reduced()).toBe(true)

    media.emit(false)
    expect(reduced()).toBe(false)
  })

  it('unsubscribes when the owning component unmounts', () => {
    const media = stubMatchMedia(false)
    const { wrapper } = mountProbe()
    expect(media.listenerCount).toBe(1)

    wrapper.unmount()

    expect(media.listenerCount).toBe(0)
  })

  it('degrades to false when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined)

    const { reduced } = mountProbe()

    // 不能因为环境缺 API 就让调用方以为用户开了减少动效。
    expect(reduced()).toBe(false)
  })
})
