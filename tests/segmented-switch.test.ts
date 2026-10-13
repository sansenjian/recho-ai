// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SegmentedSwitch from '../src/components/SegmentedSwitch.vue'

/**
 * 分段切换器。
 *
 * 它替掉的是两份字符级重复的按钮标记，所以这里盯的是「原来能做的现在还能做」：
 * 选中态、点击派发、以及两个侧栏各自不同的外层间距。
 */
describe('SegmentedSwitch', () => {
  const options = [
    { value: 'imagio', label: 'Agent' },
    { value: 'canvas', label: '画布' },
  ]

  it('renders every option and marks the active one', () => {
    const wrapper = mount(SegmentedSwitch, { props: { options, modelValue: 'imagio' } })

    const buttons = wrapper.findAll('button')
    expect(buttons.map(button => button.text())).toEqual(['Agent', '画布'])
    expect(buttons[0].attributes('aria-pressed')).toBe('true')
    expect(buttons[1].attributes('aria-pressed')).toBe('false')
  })

  it('highlights only the active option', () => {
    const wrapper = mount(SegmentedSwitch, { props: { options, modelValue: 'canvas' } })

    const [first, second] = wrapper.findAll('button')
    expect(first.classes()).toContain('bg-transparent')
    expect(second.classes()).toContain('bg-background')
  })

  it('emits the value that was clicked', async () => {
    const wrapper = mount(SegmentedSwitch, { props: { options, modelValue: 'imagio' } })

    await wrapper.findAll('button')[1].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['canvas']])
  })

  it('lets the caller set the container spacing', () => {
    // 两个侧栏的留白不同，间距必须能由调用方决定，否则抽出来就会改变其中一处的布局。
    const wrapper = mount(SegmentedSwitch, {
      props: { options, modelValue: 'imagio', containerClass: 'mx-3.5 my-[18px]' },
    })

    const group = wrapper.find('[role="group"]')
    expect(group.classes()).toContain('mx-3.5')
    expect(group.classes()).toContain('my-[18px]')
  })
})
