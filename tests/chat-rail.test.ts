import { describe, expect, it } from 'vitest'
import { buildRailTurns, clampCardTop, findActiveTurnIndex, formatTurnClock, pickActiveAnchorId, turnClockLocale } from '../src/utils/chat-rail'
import type { Message } from '../src/types'

const AT = '2026-09-28T06:32:00.000Z'

function user(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: AT }
}

function assistant(id: string, content: string, toolCount = 0): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: AT,
    toolCalls: Array.from({ length: toolCount }, (_, index) => ({ id: `${id}-tool-${index}` })) as Message['toolCalls'],
  }
}

describe('buildRailTurns', () => {
  it('opens one turn per question and folds the reply into it', () => {
    const turns = buildRailTurns([user('user-1', 'q1'), assistant('a1', 'r1'), user('user-2', 'q2'), assistant('a2', 'r2')])

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ id: 'user-1', messageIndex: 0, question: 'q1', answer: 'r1' })
    expect(turns[1]).toMatchObject({ id: 'user-2', messageIndex: 2, question: 'q2', answer: 'r2' })
  })

  it('ignores assistant messages that precede the first question', () => {
    const turns = buildRailTurns([assistant('welcome', 'hello there'), user('user-1', 'q1'), assistant('a1', 'r1')])

    expect(turns).toHaveLength(1)
    expect(turns[0].answer).toBe('r1')
  })

  it('joins every reply of a turn and counts the tool calls it made', () => {
    const turns = buildRailTurns([user('user-1', 'q1'), assistant('a1', 'r1', 1), assistant('a2', 'r2', 2)])

    expect(turns).toHaveLength(1)
    expect(turns[0].answer).toBe('r1\n\nr2')
    expect(turns[0].toolCount).toBe(3)
  })

  it('leaves the answer empty while a turn has no reply yet', () => {
    const turns = buildRailTurns([user('user-1', 'q1')])

    expect(turns[0]).toMatchObject({ answer: '', toolCount: 0 })
  })
})

describe('findActiveTurnIndex', () => {
  const messages = [user('user-1', 'q1'), assistant('a1', 'r1'), user('user-2', 'q2'), assistant('a2', 'r2')]
  const turns = buildRailTurns(messages)

  it('attributes a reply to the question it answers', () => {
    expect(findActiveTurnIndex(turns, messages, 'a1')).toBe(0)
    expect(findActiveTurnIndex(turns, messages, 'a2')).toBe(1)
    expect(findActiveTurnIndex(turns, messages, 'user-2')).toBe(1)
  })

  it('falls back to the first turn for a message that precedes every question', () => {
    const withGreeting = [assistant('welcome', 'hello'), ...messages]
    const greetingTurns = buildRailTurns(withGreeting)

    expect(findActiveTurnIndex(greetingTurns, withGreeting, 'welcome')).toBe(0)
  })

  it('reports no active turn without a highlight, an unknown message or any question', () => {
    expect(findActiveTurnIndex(turns, messages, null)).toBe(-1)
    expect(findActiveTurnIndex(turns, messages, 'missing')).toBe(-1)
    expect(findActiveTurnIndex([], [], 'user-1')).toBe(-1)
  })
})

describe('pickActiveAnchorId', () => {
  // 一轮很高时，滚动位置仍在轮内却已经离下一轮起点更近 —— 这里必须是「起点不晚于当前行的最后一轮」。
  const anchors = [
    { id: 'turn-1', offsetTop: 0 },
    { id: 'turn-2', offsetTop: 1200 },
    { id: 'turn-3', offsetTop: 2400 },
  ]

  it('keeps the current turn while the scroll position is still inside it', () => {
    expect(pickActiveAnchorId(anchors, 800)).toBe('turn-1')
    // 一轮很高：已经离下一轮起点不到 32px，但仍然没进「顶部余量」，不能提前点亮。
    expect(pickActiveAnchorId(anchors, 1167)).toBe('turn-1')
  })

  it('switches only once the next turn start passes the top line', () => {
    // 1168 + 32 = 1200，正好压在第二轮起点上，这时才算翻页。
    expect(pickActiveAnchorId(anchors, 1168)).toBe('turn-2')
    expect(pickActiveAnchorId(anchors, 1200)).toBe('turn-2')
    expect(pickActiveAnchorId(anchors, 2368)).toBe('turn-3')
  })

  it('falls back to the first turn above every start', () => {
    expect(pickActiveAnchorId(anchors, 0)).toBe('turn-1')
    expect(pickActiveAnchorId(anchors, -500)).toBe('turn-1')
  })

  it('reports nothing without anchors', () => {
    expect(pickActiveAnchorId([], 120)).toBeNull()
  })
})

describe('formatTurnClock', () => {
  it('maps the interface locale to a date locale', () => {
    expect(turnClockLocale('zh')).toBe('zh-CN')
    expect(turnClockLocale('en')).toBe('en-US')
    expect(turnClockLocale('fr')).toBe('en-US')
  })

  it('formats a timestamp with the clock of the active locale', () => {
    expect(formatTurnClock(AT, 'zh')).toBe(
      new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(Date.parse(AT)),
    )
    expect(formatTurnClock(AT, 'zh')).toMatch(/^\d{1,2}:\d{2}/)
  })

  it('returns an empty clock for an unparsable timestamp', () => {
    expect(formatTurnClock('', 'zh')).toBe('')
    expect(formatTurnClock('not-a-date', 'zh')).toBe('')
  })
})

describe('clampCardTop', () => {
  it('pulls the card up when a low marker would push it out of the rail', () => {
    expect(clampCardTop(490, 400, 120)).toBe(280)
  })

  it('leaves a card that already fits where the marker sits', () => {
    expect(clampCardTop(64, 400, 120)).toBe(64)
  })

  it('never returns a negative offset, even when the card is taller than the rail', () => {
    expect(clampCardTop(-30, 400, 120)).toBe(0)
    expect(clampCardTop(300, 100, 200)).toBe(0)
    expect(clampCardTop(10, 0, 0)).toBe(0)
  })
})

