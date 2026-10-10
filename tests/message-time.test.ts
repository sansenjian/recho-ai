import { describe, expect, it } from 'vitest'
import { formatMessageTime, isSameCalendarDay } from '../src/utils/time'

describe('formatMessageTime', () => {
  const today = new Date('2026-10-10T23:20:00')
  const now = today.getTime()

  it('shows only the clock for today', () => {
    // 同一屏几乎都是今天的消息，重复的日期是噪声。
    expect(formatMessageTime('2026-10-10T09:05:00', 'zh', now)).toBe('09:05')
  })

  it('adds the date when the message is from another day', () => {
    // 否则一串 01:01 之间分不出先后。
    expect(formatMessageTime('2026-10-08T23:20:00', 'zh', now)).toBe('10月8日 23:20')
  })

  it('uses the local calendar day rather than a 24 hour window', () => {
    // 23:00 与次日 01:00 只差两小时却分属两天。
    const lateNight = new Date('2026-10-10T23:30:00').getTime()
    const nextMorning = new Date('2026-10-11T01:00:00').getTime()
    expect(isSameCalendarDay(lateNight, nextMorning)).toBe(false)
    expect(formatMessageTime(new Date(lateNight).toISOString(), 'zh', nextMorning)).toContain('月')
  })

  it('localizes for english', () => {
    expect(formatMessageTime('2026-10-08T23:20:00', 'en', now)).toMatch(/Oct/)
  })

  it('returns an empty string for an unparsable timestamp', () => {
    expect(formatMessageTime('not-a-date', 'zh', now)).toBe('')
    expect(formatMessageTime('', 'zh', now)).toBe('')
  })
})

describe('isSameCalendarDay', () => {
  it('is true within the same local day', () => {
    expect(isSameCalendarDay(Date.parse('2026-10-10T00:01:00'), Date.parse('2026-10-10T23:59:00'))).toBe(true)
  })

  it('is false across month and year boundaries', () => {
    expect(isSameCalendarDay(Date.parse('2026-10-31T23:00:00'), Date.parse('2026-11-01T01:00:00'))).toBe(false)
    expect(isSameCalendarDay(Date.parse('2026-12-31T23:00:00'), Date.parse('2027-01-01T01:00:00'))).toBe(false)
  })
})
