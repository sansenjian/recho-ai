import { describe, expect, it } from 'vitest'
import { MENU_MAX_HEIGHT, MENU_MIN_HEIGHT, placeMenu } from '../src/utils/floating-placement'

function input(triggerTop: number, triggerBottom: number, menuLeft: number, extra: Partial<Parameters<typeof placeMenu>[0]> = {}) {
  return { triggerTop, triggerBottom, menuLeft, menuWidth: 300, viewportWidth: 1200, viewportHeight: 800, ...extra }
}

describe('placeMenu', () => {
  it('opens upward while the composer trigger has room above it', () => {
    const placement = placeMenu(input(600, 636, 400))

    expect(placement.side).toBe('up')
    expect(placement.maxHeight).toBe(MENU_MAX_HEIGHT)
    expect(placement.shiftX).toBe(0)
  })

  it('flips below when the trigger sits near the top of the viewport', () => {
    expect(placeMenu(input(40, 76, 400)).side).toBe('down')
  })

  it('measures the real leftover space instead of a fixed viewport formula', () => {
    // 下方可用 152px，减去 8px 缝隙后就是菜单高度。
    const placement = placeMenu(input(100, 136, 400, { viewportHeight: 300 }))

    expect(placement.side).toBe('down')
    expect(placement.maxHeight).toBe(144)
  })

  it('keeps a usable floor when nearly nothing fits', () => {
    expect(placeMenu(input(60, 96, 400, { viewportHeight: 160 })).maxHeight).toBe(MENU_MIN_HEIGHT)
  })

  it('caps the height so a long menu scrolls instead of leaving the viewport', () => {
    expect(placeMenu(input(700, 736, 400)).maxHeight).toBe(MENU_MAX_HEIGHT)
  })

  it('shifts the menu back inside the right edge of the viewport', () => {
    const placement = placeMenu(input(600, 636, 900, { viewportWidth: 1000 }))

    expect(placement.shiftX).toBe(-212)
  })

  it('shifts the menu right when the trigger hugs the left edge', () => {
    expect(placeMenu(input(600, 636, 4, { viewportWidth: 1000 })).shiftX).toBe(8)
  })

  it('leaves the menu alone when it already fits', () => {
    expect(placeMenu(input(600, 636, 200, { viewportWidth: 1000 })).shiftX).toBe(0)
  })

  it('pins an over-wide menu to the left gutter instead of centring it', () => {
    expect(placeMenu(input(600, 636, 50, { viewportWidth: 200 })).shiftX).toBe(-38)
  })
})
