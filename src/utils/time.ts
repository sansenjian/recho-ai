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
