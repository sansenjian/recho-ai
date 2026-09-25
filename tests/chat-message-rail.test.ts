// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessageRail from '../src/components/ChatMessageRail.vue'

describe('ChatMessageRail', () => {
  it('renders one shortcut for each message and marks the active message', () => {
    const wrapper = mount(ChatMessageRail, {
      props: {
        messages: [
          { id: 'user-1', role: 'user', content: 'hello', timestamp: 'now' },
          { id: 'assistant-1', role: 'assistant', content: 'hi', timestamp: 'now' },
        ],
        activeMessageId: 'assistant-1',
      },
    })

    expect(wrapper.findAll('button')).toHaveLength(2)
    expect(wrapper.findAll('button')[1].find('span').classes()).toContain('w-9')
  })

  it('emits the selected message id', async () => {
    const wrapper = mount(ChatMessageRail, {
      props: { messages: [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 'now' }], activeMessageId: null },
    })

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['user-1']])
  })
})
