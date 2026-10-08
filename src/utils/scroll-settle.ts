/**
 * 判断滚动容器是否已经「停止长高」。
 *
 * 会话切换后消息组件是异步加载的，容器高度会分多帧撑开；只等一次 nextTick
 * 就去滚到底，会在高度还没到位时定位，视觉上停在会话开头。这里把「高度是否
 * 稳定」抽成纯状态机，便于单测覆盖那次时序问题。
 *
 * 收敛条件：连续 FULLY_STABLE_FRAMES 次观察到与上一次相同的高度。
 * 首帧只建立基准，不计入稳定次数——否则「高度恰好等于初始哨兵值」会被误判为
 * 已经收敛。
 */
export interface ScrollSettleState {
  /** 上一次观察到的高度；undefined 表示还没观察过。 */
  lastHeight?: number
  /** 高度连续不变的次数。 */
  stableFrames: number
  /** 已经观察过的帧数。 */
  frames: number
}

/** 连续多少次高度不变才算收敛。 */
export const FULLY_STABLE_FRAMES = 2

export function createScrollSettleState(): ScrollSettleState {
  return { lastHeight: undefined, stableFrames: 0, frames: 0 }
}

/**
 * 记录一帧高度，返回是否已经可以停止观察。
 *
 * 用 maxFrames 兜底：动画或懒加载可能让高度永不重复，到达上限也要收手，
 * 否则滚动会一直不执行。
 */
export function observeScrollFrame(
  state: ScrollSettleState,
  height: number,
  maxFrames: number,
): { settled: boolean; state: ScrollSettleState } {
  const next: ScrollSettleState = { ...state, frames: state.frames + 1 }
  if (state.lastHeight !== undefined && state.lastHeight === height) {
    next.stableFrames = state.stableFrames + 1
  } else {
    next.stableFrames = 0
    next.lastHeight = height
  }
  return { settled: next.stableFrames >= FULLY_STABLE_FRAMES || next.frames >= maxFrames, state: next }
}
