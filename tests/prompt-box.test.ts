// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PromptBox from '../src/components/PromptBox.vue'

/**
 * 提示词输入框外壳。
 *
 * 它把 chat 与工作台各写一套的输入框外框收成一处，代价是两边原本各自的键盘行为也被
 * 挪进了这里。所以这里盯的是「回车提交」这条共用路径：组合输入期间不提交，其余情况下
 * 阻止换行并派发 submit。
 */
describe('PromptBox', () => {
  function mountBox() {
    return mount(PromptBox, { props: { modelValue: '' } })
  }

  it('submits on a plain Enter and blocks the newline', async () => {
    const wrapper = mountBox()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })

    wrapper.find('textarea').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('submit')).toHaveLength(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not submit while an IME is still composing', async () => {
    // 中文/日文/韩文按 Enter 选词时，浏览器派发的 keydown 带 isComposing。
    const wrapper = mountBox()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'isComposing', { value: true })

    wrapper.find('textarea').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not submit on the legacy keyCode 229 fallback', async () => {
    // 有些实现先 compositionend 再派发收尾 keydown，此时 isComposing 已经是 false，
    // 只能靠 keyCode 229 认出来。
    const wrapper = mountBox()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'keyCode', { value: 229 })

    wrapper.find('textarea').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves the Enter + modifier combination to the caller', async () => {
    const wrapper = mountBox()
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    wrapper.find('textarea').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })
})
