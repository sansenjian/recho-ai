import type { Message } from '../types'
import { formatMessageTime } from './time'

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
  /**
   * 回复正文之外的替代摘要。
   * 工作台的「回复」是图片，没有可展示的正文，用它显示「N 张图片」；对话页留空。
   */
  summary?: string
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

/** 视口顶部留出的余量：滚动位置越过它，才认为下一轮真的开始了。 */
export const ACTIVE_ANCHOR_OFFSET = 32

/** 一条可以被高亮的轮次锚点，offsetTop 是它在滚动容器内容里的纵向起点。 */
export interface ActiveAnchor {
  id: string
  offsetTop: number
}

/**
 * 当前轮次 = 起点不晚于 scrollTop + 32 的**最后一轮**；滚动位置在所有起点之前时取第一轮。
 *
 * 不能用「离视口顶部最近」：一轮可以很高（工作台一轮就是好几张图），
 * 滚动位置还在这一轮内部、但已经离下一轮起点更近时，最近距离判定会提前点亮还没进视口的下一轮。
 * 入参需按文档顺序给出 offsetTop。
 */
export function pickActiveAnchorId(anchors: readonly ActiveAnchor[], scrollTop: number): string | null {
  const line = scrollTop + ACTIVE_ANCHOR_OFFSET
  let active: string | null = null
  for (const anchor of anchors) {
    if (anchor.offsetTop > line) break
    active = anchor.id
  }
  return active ?? anchors[0]?.id ?? null
}


/** 卡片上的时间按当前界面语言格式化。 */
export function turnClockLocale(locale: string): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US'
}

/**
 * 卡片上的时间。
 *
 * 规则与消息时间一致（见 formatMessageTime）：当天只给时分，跨天补上月日。
 * 两处共用一份实现，避免轨道卡片和消息列表对同一时刻给出不同写法。
 */
export function formatTurnClock(timestamp: string, locale: string, now: number = Date.now()): string {
  return formatMessageTime(timestamp, locale, now)
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
