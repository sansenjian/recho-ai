// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginScrollGeneration,
  createScrollGeneration,
  createScrollSettleState,
  invalidateScrollGeneration,
  isScrollGenerationCurrent,
  observeScrollFrame,
} from '../src/utils/scroll-settle'

/**
 * 这组用例模拟「切换到一条长会话」的真实时序：容器高度分多帧撑开，
 * 而滚动只在高度收敛后执行一次。
 *
 * 之所以要跑真实的 rAF 循环而不是只测状态机：原始缺陷正是「只等一次
 * nextTick 就去滚」，状态机单测无法暴露调用时机的问题。
 */
function runSettleLoop(heights: number[], maxFrames: number) {
  let state = createScrollSettleState()
  const scrollCalls: number[] = []
  for (let i = 0; i < heights.length; i++) {
    const height = heights[i]
    scrollCalls.push(height)
    const result = observeScrollFrame(state, height, maxFrames)
    state = result.state
    if (result.settled) return { settledAt: i, finalHeight: height, scrollCalls }
  }
  return { settledAt: -1, finalHeight: heights[heights.length - 1], scrollCalls }
}

describe('switching to a long conversation scrolls to the newest message', () => {
  it('waits for the async message components instead of scrolling on the first frame', () => {
    // 首帧只有旧内容的高度；异步加载的 ChatMessage 逐帧把容器撑开。
    // 若在这里就定稿，视图会停在会话开头——正是用户报的问题。
    const { settledAt, finalHeight } = runSettleLoop([200, 800, 2000, 5000, 5000, 5000], 12)
    expect(settledAt).toBeGreaterThanOrEqual(3)
    expect(finalHeight).toBe(5000)
  })

  it('ends at the bottom of the fully rendered list', () => {
    // 收敛后最后一帧的高度就是最终滚动目标；它必须是最新消息所在的底部。
    //
    // 下标说明：0 帧建立基准，1/2 帧高度仍在变，3 帧起连续三次 6000，
    // 到第 6 帧才满足「连续两帧不变」——首帧只建立基准，不计入稳定次数。
    const heights = [300, 900, 2400, 4800, 6000, 6000, 6000]
    const { settledAt, finalHeight } = runSettleLoop(heights, 12)
    expect(settledAt).toBe(6)
    expect(finalHeight).toBe(6000)
  })

  it('does not stall when images keep the height changing', () => {
    // 懒加载图片可能让高度一直变；兜底帧数到了必须收手，否则永远不滚动。
    const growing = Array.from({ length: 20 }, (_, i) => 500 + i * 300)
    const { settledAt, finalHeight } = runSettleLoop(growing, 12)
    expect(settledAt).toBe(11)
    expect(finalHeight).toBe(500 + 11 * 300)
  })
})


describe('scroll generation', () => {
  it('invalidates an older loop when a newer one starts', () => {
    // 连续切会话时，前一次的收敛循环仍在跑；它每帧重读容器，会把新会话也拉到底。
    const generation = createScrollGeneration()
    const first = beginScrollGeneration(generation)
    expect(isScrollGenerationCurrent(generation, first)).toBe(true)

    const second = beginScrollGeneration(generation)
    expect(isScrollGenerationCurrent(generation, first)).toBe(false)
    expect(isScrollGenerationCurrent(generation, second)).toBe(true)
  })

  it('invalidates in-flight loops on unmount', () => {
    const generation = createScrollGeneration()
    const token = beginScrollGeneration(generation)
    invalidateScrollGeneration(generation)
    expect(isScrollGenerationCurrent(generation, token)).toBe(false)
  })

  it('keeps a loop valid while no newer one starts', () => {
    const generation = createScrollGeneration()
    const token = beginScrollGeneration(generation)
    for (let i = 0; i < 5; i++) {
      expect(isScrollGenerationCurrent(generation, token)).toBe(true)
    }
  })
})

describe('raf driven scroll', () => {
  const frames: FrameRequestCallback[] = []

  beforeEach(() => {
    frames.length = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function drain(maxTicks = 30) {
    let ticks = 0
    while (frames.length > 0 && ticks < maxTicks) {
      const cb = frames.shift()!
      cb(ticks * 16)
      ticks += 1
    }
    return ticks
  }

  it('schedules work across multiple animation frames', () => {
    // 直接的证据：滚动不是一次跑完，而是跨多帧观察高度后才定稿。
    const target = {
      scrollHeight: 200,
      scrollTo: vi.fn(),
    }
    let state = createScrollSettleState()
    // 让高度先涨后停：涨的几帧必须继续排队，停下后连续两帧才收手。
    let growth = 3
    const settle = () => {
      if (growth > 0) {
        target.scrollHeight += 1200
        growth -= 1
      }
      target.scrollTo({ top: target.scrollHeight, behavior: 'auto' })
      const result = observeScrollFrame(state, target.scrollHeight, 12)
      state = result.state
      if (result.settled) return
      requestAnimationFrame(settle)
    }
    settle()
    expect(target.scrollTo).toHaveBeenCalledTimes(1)

    const ticks = drain()
    // 首帧 + 3 次增长 + 稳定两帧，至少要多轮 rAF 才能收敛。
    expect(ticks).toBeGreaterThan(1)
    expect(state.stableFrames).toBeGreaterThanOrEqual(2)
    expect(state.frames).toBe(ticks + 1)
    expect(target.scrollTo).toHaveBeenLastCalledWith({ top: target.scrollHeight, behavior: 'auto' })
  })
})
