// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ChatMessageRail from '../src/components/ChatMessageRail.vue'
import i18n from '../src/i18n'

interface RailMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: { id: string }[]
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
const CARD = '[data-slot="chat-turn-card"]'

function markerClasses(wrapper: ReturnType<typeof mountRail>, turnIndex: number) {
  return wrapper.findAll('button')[turnIndex].find('span').classes()
}

function markerWidth(wrapper: ReturnType<typeof mountRail>, turnIndex: number) {
  const classes = markerClasses(wrapper, turnIndex)
  return WAVE_WIDTHS.find(width => classes.includes(width))
}

describe('ChatMessageRail markers', () => {
  it('renders one marker per question and leaves the assistant replies out', () => {
    const wrapper = mountRail(conversation(3), 'user-3')

    expect(wrapper.findAll('button')).toHaveLength(3)
    expect(wrapper.findAll('button')[2].attributes('aria-label')).toBe(i18n.global.t('chat.jumpToTurn', { index: 3 }))
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

describe('ChatMessageRail turn card', () => {
  it('opens on hover with the counter, the question and the answer', async () => {
    const wrapper = mountRail(conversation(3), 'user-3')

    expect(wrapper.find(CARD).exists()).toBe(false)

    await wrapper.findAll('button')[1].trigger('mouseenter')

    const card = wrapper.find(CARD)
    expect(card.exists()).toBe(true)
    expect(card.attributes('role')).toBe('tooltip')
    expect(wrapper.findAll('button')[1].attributes('aria-describedby')).toBe(card.attributes('id'))
    expect(card.text()).toContain(i18n.global.t('chat.turnCounter', { index: 2, total: 3 }))
    expect(card.text()).toContain('question 2')
    expect(card.text()).toContain('answer 2')
    expect(card.text()).not.toContain('question 1')
  })

  it('closes when the pointer leaves the rail', async () => {
    const wrapper = mountRail(conversation(2), 'user-1')

    await wrapper.findAll('button')[0].trigger('mouseenter')
    expect(wrapper.find(CARD).exists()).toBe(true)

    await wrapper.find('[data-slot="chat-turn-rail"]').trigger('mouseleave')
    expect(wrapper.find(CARD).exists()).toBe(false)
  })

  it('opens on keyboard focus and clamps both previews', async () => {
    const wrapper = mountRail(conversation(2), 'user-1')

    await wrapper.findAll('button')[0].trigger('focus')

    const card = wrapper.find(CARD)
    expect(card.exists()).toBe(true)
    expect(card.findAll('p')[0].classes()).toContain('line-clamp-2')
    expect(card.findAll('p')[1].classes()).toContain('line-clamp-3')
  })

  it('shows the pending hint while a turn has no reply yet', async () => {
    const wrapper = mountRail([{ id: 'user-1', role: 'user', content: 'question 1', timestamp: 'now' }], 'user-1')

    await wrapper.findAll('button')[0].trigger('mouseenter')

    expect(wrapper.find(CARD).text()).toContain(i18n.global.t('chat.turnPending'))
  })

  it('clamps the card again when the same marker is reopened', async () => {
    const wrapper = mountRail(conversation(2), 'user-1')
    // 根节点前面有一个注释节点，组件根其实是 fragment，所以 wrapper.element 拿到的是注释；
    // 必须按 data-slot 取那条真正的轨道。
    const rail = wrapper.find('[data-slot="chat-turn-rail"]').element as HTMLElement
    const markers = wrapper.findAll('button')
    const marker = markers[1].element as HTMLElement

    // jsdom 没有布局，这里按真实场景手动喂一组几何：贴底的标记 + 400px 高的轨道 + 120px 高的卡片。
    Object.defineProperty(rail, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0 }) })
    Object.defineProperty(marker, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 380 }) })
    Object.defineProperty(rail, 'clientHeight', { configurable: true, value: 400 })

    await markers[1].trigger('mouseenter')
    await flushPromises()

    // 卡片渲染出来之后才量得到真实高度。
    Object.defineProperty(wrapper.find(CARD).element, 'offsetHeight', { configurable: true, value: 120 })

    // 悬停之后点击同一个标记会再触发一次 focus，此时 openTurn 没变、watch 不会重跑，
    // 所以夹紧必须发生在 openCard 内部，否则卡片又回到未夹紧的 370px 被外层裁掉。
    await markers[1].trigger('focus')
    await flushPromises()

    expect(wrapper.find(CARD).attributes('style')).toContain('top: 280px')
  })

  it('reports how many tool calls the turn made', async () => {
    const messages: RailMessage[] = [
      { id: 'user-1', role: 'user', content: 'question 1', timestamp: 'now' },
      { id: 'assistant-1', role: 'assistant', content: 'answer 1', timestamp: 'now', toolCalls: [{ id: 'tool-1' }, { id: 'tool-2' }] },
    ]
    const wrapper = mountRail(messages, 'user-1')

    await wrapper.findAll('button')[0].trigger('mouseenter')

    expect(wrapper.find(CARD).text()).toContain(i18n.global.t('chat.turnTools', { count: 2 }))
  })
})
