// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessageRail from '../src/components/ChatMessageRail.vue'
import i18n from '../src/i18n'

interface RailMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

/** 一轮 = 一条提问 + 一条回复。 */
function conversation(turnCount: number): RailMessage[] {
  const messages: RailMessage[] = []
  for (let index = 0; index < turnCount; index += 1) {
    messages.push({ id: `user-${index + 1}`, role: 'user', content: `question ${index + 1}`, timestamp: 'now' })
    messages.push({ id: `assistant-${index + 1}`, role: 'assistant', content: `answer ${index + 1}`, timestamp: 'now' })
  }
  return messages
}

function mountRail(messages: RailMessage[], activeMessageId: string | null) {
  return mount(ChatMessageRail, {
    global: { plugins: [i18n] },
    props: { messages, activeMessageId },
  })
}

const WAVE_WIDTHS = ['w-8', 'w-6', 'w-[18px]', 'w-3']

function markerClasses(wrapper: ReturnType<typeof mountRail>, turnIndex: number) {
  return wrapper.findAll('button')[turnIndex].find('span').classes()
}

function markerWidth(wrapper: ReturnType<typeof mountRail>, turnIndex: number) {
  const classes = markerClasses(wrapper, turnIndex)
  return WAVE_WIDTHS.find(width => classes.includes(width))
}

describe('ChatMessageRail', () => {
  it('renders one marker per question and leaves the assistant replies out', () => {
    const wrapper = mountRail(conversation(3), 'user-3')

    expect(wrapper.findAll('button')).toHaveLength(3)
    expect(wrapper.findAll('button')[2].attributes('title')).toBe(i18n.global.t('chat.jumpToTurn', { index: 3 }))
  })

  it('renders nothing while the conversation holds no question yet', () => {
    const wrapper = mountRail([{ id: 'assistant-1', role: 'assistant', content: 'hello', timestamp: 'now' }], 'assistant-1')

    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('attributes an assistant reply to the question it answers', () => {
    const wrapper = mountRail(conversation(3), 'assistant-2')

    expect(wrapper.findAll('button')[1].attributes('aria-current')).toBe('true')
    expect(wrapper.findAll('button')[0].attributes('aria-current')).toBeUndefined()
    expect(wrapper.findAll('button')[2].attributes('aria-current')).toBeUndefined()
  })

  it('emits the question id of the selected turn', async () => {
    const wrapper = mountRail(conversation(2), 'user-1')

    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['user-2']])
  })

  it('shortens the markers in steps the further they sit from the active turn', () => {
    const wrapper = mountRail(conversation(7), 'assistant-4')

    const widths = Array.from({ length: 7 }, (_, index) => markerWidth(wrapper, index))

    expect(widths).toEqual(['w-3', 'w-[18px]', 'w-6', 'w-8', 'w-6', 'w-[18px]', 'w-3'])
  })

  it('keeps every marker short while no message is active', () => {
    const wrapper = mountRail(conversation(3), null)

    const widths = Array.from({ length: 3 }, (_, index) => markerWidth(wrapper, index))

    expect(widths).toEqual(['w-3', 'w-3', 'w-3'])
  })

  it('pulses the active marker and fades its neighbours', () => {
    const wrapper = mountRail(conversation(5), 'assistant-3')

    expect(markerClasses(wrapper, 2)).toContain('animate-turn-marker-pulse')
    expect(markerClasses(wrapper, 2)).toContain('opacity-100')
    expect(markerClasses(wrapper, 4)).toContain('opacity-60')
    expect(markerClasses(wrapper, 4)).toContain('group-hover:w-8')
  })

  it('falls back to the first turn when the active message precedes every question', () => {
    const messages: RailMessage[] = [
      { id: 'assistant-0', role: 'assistant', content: 'welcome', timestamp: 'now' },
      ...conversation(2),
    ]
    const wrapper = mountRail(messages, 'assistant-0')

    expect(wrapper.findAll('button')[0].attributes('aria-current')).toBe('true')
    expect(markerWidth(wrapper, 0)).toBe('w-8')
  })
})
