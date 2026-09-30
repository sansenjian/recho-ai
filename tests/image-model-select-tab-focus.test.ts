// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ImageModelSelect from '../src/components/ImageModelSelect.vue'
import i18n from '../src/i18n'

const OPTIONS = [
  { value: 'gpt-image-2.5', label: 'GPT Image 2.5' },
  { value: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
]

// 把组件夹在两个邻居按钮之间,才能看出 Tab 是「走到下一个控件」还是「被吞掉」。
function mountBetweenNeighbours() {
  const before = document.createElement('button')
  before.textContent = 'before'
  const after = document.createElement('button')
  after.textContent = 'after'
  document.body.appendChild(before)

  const wrapper = mount(ImageModelSelect, {
    props: { modelValue: 'gpt-image-2.5', defaultModel: 'gpt-image-2.5', options: OPTIONS },
    global: { plugins: [i18n] },
  })
  document.body.appendChild(wrapper.element)
  document.body.appendChild(after)

  return { wrapper, before, after }
}

async function openMenu(wrapper: VueWrapper) {
  await wrapper.get('.image-model-trigger').trigger('click')
  await nextTick()
  await nextTick()
  return wrapper.get('.image-model-menu')
}

function pressTab(shiftKey = false) {
  const target = document.activeElement ?? document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('image model select tab focus', () => {
  it('moves focus to the next control instead of dumping it on body', async () => {
    const { wrapper, after } = mountBetweenNeighbours()
    const listbox = await openMenu(wrapper)
    // 打开后焦点在列表本身上,当前项由 aria-activedescendant 播报。
    ;(listbox.element as HTMLElement).focus()
    expect(document.activeElement).toBe(listbox.element)

    pressTab()
    await nextTick()

    expect(document.activeElement).toBe(after)
  })

  it('moves focus backwards on shift+tab', async () => {
    const { wrapper, before } = mountBetweenNeighbours()
    const listbox = await openMenu(wrapper)
    ;(listbox.element as HTMLElement).focus()

    pressTab(true)
    await nextTick()

    expect(document.activeElement).toBe(before)
  })

  it('skips the option buttons that are still mounted for this tick', async () => {
    const { wrapper, after } = mountBetweenNeighbours()
    const listbox = await openMenu(wrapper)
    ;(listbox.element as HTMLElement).focus()

    pressTab()
    await nextTick()

    // 若没排除菜单子树,Tab 会先落进第一个 .image-model-option。
    expect(document.activeElement).toBe(after)
    expect((document.activeElement as HTMLElement).classList.contains('image-model-option')).toBe(false)
  })

  it('closes the menu once tab has moved on', async () => {
    const { wrapper } = mountBetweenNeighbours()
    const listbox = await openMenu(wrapper)
    ;(listbox.element as HTMLElement).focus()

    pressTab()
    await nextTick()

    expect(wrapper.find('.image-model-menu').exists()).toBe(false)
  })

  it('keeps focus on the trigger when it has no neighbours', async () => {
    const wrapper = mount(ImageModelSelect, {
      props: { modelValue: 'gpt-image-2.5', defaultModel: 'gpt-image-2.5', options: OPTIONS },
      global: { plugins: [i18n] },
    })
    document.body.appendChild(wrapper.element)
    const listbox = await openMenu(wrapper)
    ;(listbox.element as HTMLElement).focus()

    pressTab()
    await nextTick()

    // 宁可留在触发器上,也不要把焦点丢给 body。
    expect(document.activeElement).toBe(wrapper.get('.image-model-trigger').element)
  })
})
