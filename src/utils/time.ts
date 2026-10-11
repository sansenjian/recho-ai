export function relativeTime(ts: string): string {
  if (ts === 'just now') return '刚刚'
  const date = new Date(ts)
  if (isNaN(date.getTime())) return ts
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return ts
}

/**
 * 消息时间的统一格式。
 *
 * 当天只给「时:分」——同一屏几乎都是今天的消息，重复的日期是噪声。跨天的补上
 * 「月日」，否则一串 01:01 之间分不出先后，用户没法判断这是今天聊的还是上周的。
 *
 * 判断用本地日历日而不是 24 小时差：23:00 与次日 01:00 只差两小时却分属两天。
 * 解析不了返回空串，由调用方决定是否隐藏。
 */
export function formatMessageTime(ts: string, locale = 'zh', now: number = Date.now()): string {
  const at = Date.parse(ts)
  if (!Number.isFinite(at)) return ''
  const localeName = locale === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(localeName, isSameCalendarDay(at, now)
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)
}

/** 两个时间戳是否落在同一个本地日历日。 */
export function isSameCalendarDay(a: number, b: number): boolean {
  const left = new Date(a)
  const right = new Date(b)
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
}