// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessageRail from '../src/components/ChatMessageRail.vue'
import i18n from '../src/i18n'

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${index}`,
    timestamp: 'now',
  }))
}

function mountRail(messages: ReturnType<typeof makeMessages>, activeMessageId: string | null) {
  return mount(ChatMessageRail, {
    global: { plugins: [i18n] },
    props: { messages, activeMessageId },
  })
}

const WAVE_WIDTHS = ["w-8", "w-6", "w-[18px]", "w-3"]

function markerClasses(wrapper: ReturnType<typeof mountRail>, index: number) {
  return wrapper.findAll('button')[index].find('span').classes()
}

function markerWidth(wrapper: ReturnType<typeof mountRail>, index: number) {
  const classes = markerClasses(wrapper, index)
  return WAVE_WIDTHS.find(width => classes.includes(width))
}

describe('ChatMessageRail', () => {
  it('renders one shortcut for each message and marks the active message', () => {
    const wrapper = mountRail(makeMessages(2), 'message-1')

    expect(wrapper.findAll('button')).toHaveLength(2)
    expect(markerWidth(wrapper, 1)).toBe('w-8')
    expect(wrapper.findAll('button')[1].attributes('aria-current')).toBe('true')
    expect(wrapper.findAll('button')[0].attributes('aria-current')).toBeUndefined()
  })

  it('emits the selected message id', async () => {
    const wrapper = mountRail(makeMessages(1), null)

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['message-0']])
  })

  it('shortens the markers in steps the further they sit from the active message', () => {
    const wrapper = mountRail(makeMessages(7), 'message-3')

    const widths = Array.from({ length: 7 }, (_, index) => markerWidth(wrapper, index))

    expect(widths).toEqual(['w-3', 'w-[18px]', 'w-6', 'w-8', 'w-6', 'w-[18px]', 'w-3'])
  })

  it('keeps every marker short while no message is active', () => {
    const wrapper = mountRail(makeMessages(3), null)

    const widths = Array.from({ length: 3 }, (_, index) => markerWidth(wrapper, index))

    expect(widths).toEqual(['w-3', 'w-3', 'w-3'])
  })

  it('pulses the active marker and fades its neighbours', () => {
    const wrapper = mountRail(makeMessages(5), 'message-2')

    expect(markerClasses(wrapper, 2)).toContain('animate-turn-marker-pulse')
    expect(markerClasses(wrapper, 2)).toContain('opacity-100')
    expect(markerClasses(wrapper, 4)).toContain('opacity-60')
    expect(markerClasses(wrapper, 4)).toContain('group-hover:w-8')
    expect(markerClasses(wrapper, 0)).toContain('bg-muted-foreground')
    expect(markerClasses(wrapper, 1)).toContain('bg-foreground')
  })
})
