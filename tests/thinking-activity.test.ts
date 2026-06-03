import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ThinkingActivity from '../src/components/ThinkingActivity.vue'

describe('ThinkingActivity', () => {
  it('shows a running placeholder before the first thinking delta arrives', () => {
    const wrapper = mount(ThinkingActivity, {
      props: {
        content: '',
        status: 'running',
        active: true,
        embedded: true,
      },
    })

    expect(wrapper.find('.thinking-activity').exists()).toBe(true)
    expect(wrapper.text()).toContain('思考中')
    expect(wrapper.text()).toContain('正在等待模型返回可展示思考内容')
  })

  it('shows running thinking content immediately and keeps streaming updates visible', async () => {
    const wrapper = mount(ThinkingActivity, {
      props: {
        content: '正在拆解用户目标',
        status: 'running',
        active: true,
        embedded: true,
      },
    })

    expect(wrapper.find('.thinking-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('正在拆解用户目标')

    await wrapper.setProps({
      content: '正在拆解用户目标\n继续判断是否需要搜索',
    })

    expect(wrapper.find('.thinking-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('继续判断是否需要搜索')
  })
})
