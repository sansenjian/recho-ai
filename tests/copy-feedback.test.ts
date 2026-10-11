// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { useCopyFeedback } from '../src/composables/useCopyFeedback'

/** 在独立作用域里跑，才能触发 onBeforeUnmount 的清理。 */
function withScope<T>(fn: () => T) {
  const scope = effectScope()
  const result = scope.run(fn)!
  return { result, stop: () => scope.stop() }
}

describe('useCopyFeedback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('marks the copied item and clears it after the delay', () => {
    const { result } = withScope(() => useCopyFeedback())
    expect(result.isCopied('m1')).toBe(false)

    result.markCopied('m1')
    expect(result.isCopied('m1')).toBe(true)

    vi.advanceTimersByTime(1500)
    expect(result.isCopied('m1')).toBe(false)
  })

  it('keeps the newest mark when copying twice quickly', () => {
    // 列表里可能连着点两条；先点的那个定时器不该清掉后点的高亮。
    const { result } = withScope(() => useCopyFeedback())
    result.markCopied('m1')
    vi.advanceTimersByTime(1000)
    result.markCopied('m2')

    vi.advanceTimersByTime(600)
    // m1 的定时器已到期，但当前显示的是 m2，不能被它清掉。
    expect(result.isCopied('m2')).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(result.isCopied('m2')).toBe(false)
  })

  it('does not touch state after the scope is disposed', () => {
    const { result, stop } = withScope(() => useCopyFeedback())
    result.markCopied('m1')
    stop()
    vi.advanceTimersByTime(5000)
    // 卸载后定时器已被清掉，状态保持原样也不会报错。
    expect(result.copiedId.value).toBe('m1')
  })
})
