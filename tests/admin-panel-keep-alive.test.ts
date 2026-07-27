// @vitest-environment jsdom

import { defineComponent, h, KeepAlive, nextTick, onMounted, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

describe('admin panel cache', () => {
  it('does not remount a panel after switching away and back', async () => {
    const overviewMounted = vi.fn()
    const overview = defineComponent({
      name: 'OverviewPanel',
      setup() {
        onMounted(overviewMounted)
        return () => h('div', 'overview')
      },
    })
    const settings = defineComponent({
      name: 'SettingsPanel',
      setup: () => () => h('div', 'settings'),
    })
    const active = ref(overview)
    mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => h(active.value) }),
    }))

    active.value = settings
    await nextTick()
    active.value = overview
    await nextTick()

    expect(overviewMounted).toHaveBeenCalledTimes(1)
  })
})
