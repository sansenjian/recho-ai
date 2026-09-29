export interface MenuPlacementInput {
  /** 触发器上边缘的视口坐标。 */
  triggerTop: number
  /** 触发器下边缘的视口坐标。 */
  triggerBottom: number
  /** 菜单未被平移时的左边缘；水平夹取要减掉已施加的位移才能还原它。 */
  menuLeft: number
  menuWidth: number
  viewportWidth: number
  viewportHeight: number
}

export interface MenuPlacement {
  side: 'up' | 'down'
  /** 相对当前自然位置的水平位移(px)，正值向右。挂在 `translate` 上，不参与 transform 入场动画。 */
  shiftX: number
  /** 菜单可用高度上限(px)，由真实剩余空间算出，而不是写死的视口公式。 */
  maxHeight: number
}

/** 视口安全边距：菜单再宽也不贴屏幕边缘。 */
export const MENU_GUTTER = 12
/** 触发器与菜单之间的缝隙。 */
export const MENU_GAP = 8
/** 空间再紧也要保住的最小高度；宁可略微溢出，也不要只剩一条缝。 */
export const MENU_MIN_HEIGHT = 60
/** 菜单高度上限，超过就在菜单内部滚动。 */
export const MENU_MAX_HEIGHT = 360
/** 上方至少留出这么多空间才优先向上弹。 */
export const MENU_UP_PREFERENCE = 260

/**
 * 按触发器与菜单的真实位置算出菜单该怎么放：向上还是向下、水平要不要平移、最高能有多高。
 *
 * 纯函数、不碰 DOM。之所以要测量而不是交给 CSS：工作台的输入框贴着视口底部，
 * 菜单该翻到上面还是下面、还剩多少高度，只有量出来才知道；
 * 固定写 `bottom: 100%` 加一个 `calc(100vh - 180px)`，在小窗口或长菜单上必然顶出屏幕。
 */
export function placeMenu(input: MenuPlacementInput): MenuPlacement {
  const { triggerTop, triggerBottom, menuLeft, menuWidth, viewportWidth, viewportHeight } = input

  const above = triggerTop - MENU_GUTTER
  const below = viewportHeight - triggerBottom - MENU_GUTTER
  // 上方够用就优先向上——触发器在底部是常态；真挤了再翻到下方。
  const side = above >= Math.min(MENU_UP_PREFERENCE, below) ? 'up' : 'down'

  const available = (side === 'up' ? above : below) - MENU_GAP
  const maxHeight = Math.min(MENU_MAX_HEIGHT, Math.max(MENU_MIN_HEIGHT, available))

  // 菜单比视口还宽时上限会小于左边距，此时贴着左边距即可，不再谈对齐。
  const limit = viewportWidth - menuWidth - MENU_GUTTER
  const left = Math.max(MENU_GUTTER, Math.min(menuLeft, limit))

  return { side, shiftX: left - menuLeft, maxHeight }
}
