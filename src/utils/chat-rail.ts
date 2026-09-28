import type { Message } from '../types'

/** 轨道上的一格：一条用户提问，以及它引出的回复。 */
export interface RailTurn {
  /** 该轮提问的消息 id，也是点击后跳转到的锚点（该轮起点）。 */
  id: string
  /** 提问在 messages 里的下标，用来把滚动位置映射回轮次。 */
  messageIndex: number
  /** 提问正文。 */
  question: string
  /** 该轮已有的回复正文，多段之间以空行分隔。 */
  answer: string
  /** 提问时间戳（ISO 串）。 */
  timestamp: string
  /** 该轮回复里累计的工具调用次数。 */
  toolCount: number
}

/**
 * 把消息流折叠成轮次：只有用户提问会开一格，助手回复、流式分片与工具调用都归入它所属的那一轮。
 * 第一条提问之前的助手消息（例如开场欢迎语）不属于任何轮次，直接忽略。
 */
export function buildRailTurns(messages: readonly Message[]): RailTurn[] {
  const turns: RailTurn[] = []
  messages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      turns.push({
        id: message.id,
        messageIndex,
        question: message.content,
        answer: '',
        timestamp: message.timestamp,
        toolCount: 0,
      })
      return
    }
    const turn = turns[turns.length - 1]
    if (!turn) return
    if (message.content) turn.answer = turn.answer ? `${turn.answer}\n\n${message.content}` : message.content
    turn.toolCount += message.toolCalls?.length ?? 0
  })
  return turns
}

/**
 * 当前消息落在哪一轮：两轮之间的回复归属于它前面那一轮。
 * 返回 -1 表示无法定位（没有轮次、消息不在列表里，或还没有高亮任何消息）。
 */
export function findActiveTurnIndex(
  turns: readonly RailTurn[],
  messages: readonly Message[],
  activeMessageId: string | null,
): number {
  if (!turns.length || !activeMessageId) return -1
  const messageIndex = messages.findIndex(message => message.id === activeMessageId)
  if (messageIndex < 0) return -1
  let turnIndex = -1
  for (const [index, turn] of turns.entries()) {
    if (turn.messageIndex > messageIndex) break
    turnIndex = index
  }
  // 当前消息排在第一条提问之前时，高亮第一轮而不是整条轨道熄灭。
  return Math.max(0, turnIndex)
}

/** 卡片上的时间按当前界面语言格式化。 */
export function turnClockLocale(locale: string): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US'
}

/** 把 ISO 时间戳格式化为「时:分」；解析不了就返回空串，由调用方决定是否隐藏。 */
export function formatTurnClock(timestamp: string, locale: string): string {
  const at = Date.parse(timestamp)
  if (!Number.isFinite(at)) return ''
  return new Intl.DateTimeFormat(turnClockLocale(locale), { hour: '2-digit', minute: '2-digit' }).format(at)
}

/**
 * 把卡片夹在轨道高度以内。
 * 最后一轮的标记贴在轨道底部，卡片会伸出 rail，被外层 overflow-hidden 裁掉，
 * 所以在卡片渲染后按它的真实高度回收纵向位置。
 */
export function clampCardTop(anchorTop: number, railHeight: number, cardHeight: number): number {
  const maxTop = Math.max(0, railHeight - cardHeight)
  return Math.min(Math.max(0, anchorTop), maxTop)
}
