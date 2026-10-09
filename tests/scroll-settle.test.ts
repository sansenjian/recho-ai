import { describe, expect, it } from 'vitest'
import { FULLY_STABLE_FRAMES, createScrollSettleState, observeScrollFrame } from '../src/utils/scroll-settle'

describe('scroll settle', () => {
  it('keeps waiting while the container is still growing', () => {
    // 异步组件逐帧渲染时高度一直在涨，此时不能认为已经可以定位。
    let state = createScrollSettleState()
    for (const height of [100, 300, 700, 1200]) {
      const result = observeScrollFrame(state, height, 12)
      state = result.state
      expect(result.settled).toBe(false)
    }
  })

  it('settles once the height has been unchanged for the full stable span', () => {
    // 首帧建立基准，之后连续 FULLY_STABLE_FRAMES 帧不变才算撑开完毕。
    let state = createScrollSettleState()
    let result = observeScrollFrame(state, 1200, 12)
    state = result.state
    expect(result.settled).toBe(false)

    for (let i = 0; i < FULLY_STABLE_FRAMES; i++) {
      result = observeScrollFrame(state, 1200, 12)
      state = result.state
      const isLast = i === FULLY_STABLE_FRAMES - 1
      expect(result.settled).toBe(isLast)
    }
  })

  it('restarts counting when the height grows again after a stable frame', () => {
    // 某一帧高度恰好与前一次相同、随后又被图片撑开，必须重新计数而不是
    // 提前收敛——否则图片还没渲染完就滚了，位置会停在半路。
    let state = createScrollSettleState()
    state = observeScrollFrame(state, 800, 12).state
    expect(state.stableFrames).toBe(0)

    const same = observeScrollFrame(state, 800, 12)
    expect(same.state.stableFrames).toBe(1)
    expect(same.settled).toBe(false)

    const grown = observeScrollFrame(same.state, 1400, 12)
    expect(grown.settled).toBe(false)
    expect(grown.state.stableFrames).toBe(0)
    expect(grown.state.lastHeight).toBe(1400)
  })

  it('gives up after the frame budget so a never-stable page still scrolls', () => {
    // 懒加载图片或动画可能让高度永不重复；兜底帧数到了也要收手，
    // 否则滚动永远不会发生，用户会停在会话开头。
    let state = createScrollSettleState()
    let settled = false
    for (let i = 0; i < 12; i++) {
      const result = observeScrollFrame(state, 100 + i * 10, 12)
      state = result.state
      settled = result.settled
    }
    expect(settled).toBe(true)
  })
})
