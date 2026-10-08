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
 * 把元素滚到指定位置，兼容没有 scrollTo 的环境。
 *
 * 浏览器都实现了 Element.scrollTo，但 jsdom 没有——组件测试渲染到带滚动的视图时
 * 会抛 "scrollTo is not a function"，让整条流水线红掉。这里在缺失时退回直接写
 * scrollTop，行为等价（都是瞬时定位），真实浏览器仍走原生实现。
 */
export function scrollElementTo(
  element: { scrollTo?: unknown; scrollTop: number },
  top: number,
  smooth = false,
): void {
  if (typeof element.scrollTo === 'function') {
    ;(element.scrollTo as (options: ScrollToOptions) => void)({
      top,
      behavior: smooth ? 'smooth' : 'auto',
    })
    return
  }
  element.scrollTop = top
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
