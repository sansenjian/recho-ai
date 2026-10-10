// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  effectiveModelPrice,
  fillRows,
  normalizeModelPriceRows,
  normalizeVisibleModels,
  visibleModelsDirty,
} from '../src/utils/admin-runtime-settings'

describe('normalizeModelPriceRows', () => {
  it('trims ids and rounds costs to two decimals', () => {
    // 保留原始精度会让库里存下 1.239 这类值，展示与实际扣费的口径就不一致了。
    expect(normalizeModelPriceRows([{ id: '  gpt-image-2  ', cost: 1.239 }]))
      .toEqual([{ id: 'gpt-image-2', cost: 1.24 }])
  })

  it('rounds both up and down to the nearest cent', () => {
    expect(normalizeModelPriceRows([
      { id: 'up', cost: 1.235 },
      { id: 'down', cost: 1.234 },
      { id: 'exact', cost: 2 },
    ])).toEqual([
      { id: 'up', cost: 1.24 },
      { id: 'down', cost: 1.23 },
      { id: 'exact', cost: 2 },
    ])
  })

  it('drops empty ids, duplicates and non-positive costs', () => {
    // 丢弃而不是钳成默认价：一次手滑输入不该静默改动某个模型的真实计费。
    const rows = [
      { id: '', cost: 2 },
      { id: '   ', cost: 3 },
      { id: 'a', cost: 0 },
      { id: 'a', cost: -1 },
      { id: 'a', cost: 2 },
      { id: 'a', cost: 9 },
      { id: 'b', cost: 5 },
    ]
    expect(normalizeModelPriceRows(rows)).toEqual([
      { id: 'a', cost: 2 },
      { id: 'b', cost: 5 },
    ])
  })

  it('rejects costs that are not positive numbers', () => {
    expect(normalizeModelPriceRows([
      { id: 'a', cost: Number.NaN },
      { id: 'b', cost: Number.POSITIVE_INFINITY },
    ])).toEqual([])
  })
})

describe('normalizeVisibleModels', () => {
  it('keeps supportsTransparent and fills it with false when absent', () => {
    // 丢掉能力位会让后端把它规范化成 false，把透明背景能力悄悄关掉。
    expect(normalizeVisibleModels([
      { id: 'a', name: 'A', supportsTransparent: true },
      { id: 'b' },
    ])).toEqual([
      { id: 'a', name: 'A', supportsTransparent: true },
      { id: 'b', name: '', supportsTransparent: false },
    ])
  })

  it('drops blank rows and de-duplicates by id', () => {
    expect(normalizeVisibleModels([
      { id: '', name: 'x' },
      { id: '  ', name: 'y' },
      { id: ' a ', name: ' first ' },
      { id: 'a', name: 'second' },
    ])).toEqual([{ id: 'a', name: 'first', supportsTransparent: false }])
  })

  it('treats undefined as an empty list', () => {
    expect(normalizeVisibleModels(undefined)).toEqual([])
  })
})

describe('visibleModelsDirty', () => {
  it('ignores irrelevant differences such as ordering of whitespace', () => {
    expect(visibleModelsDirty(
      [{ id: ' a ', name: ' A ', supportsTransparent: true }],
      [{ id: 'a', name: 'A', supportsTransparent: true }],
    )).toBe(false)
  })

  it('detects a real change', () => {
    expect(visibleModelsDirty([{ id: 'a', name: '', supportsTransparent: false }], []))
      .toBe(true)
  })

  it('treats an untouched list as clean even when loaded is undefined', () => {
    expect(visibleModelsDirty([], undefined)).toBe(false)
  })
})

describe('effectiveModelPrice', () => {
  it('uses the override when it is a usable price', () => {
    expect(effectiveModelPrice(2.5, 1)).toBe(2.5)
  })

  it('falls back when the override is missing or not a positive number', () => {
    expect(effectiveModelPrice(undefined, 3)).toBe(3)
    expect(effectiveModelPrice(null, 3)).toBe(3)
    expect(effectiveModelPrice(0, 3)).toBe(3)
    expect(effectiveModelPrice(Number.NaN, 3)).toBe(3)
  })
})

describe('fillRows', () => {
  it('appends only rows whose id is not present yet', () => {
    const rows = [{ id: 'a', cost: 1 }]
    fillRows(rows, ['a', 'b', 'c'], id => ({ id, cost: 0 }))
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not duplicate when the same candidate repeats', () => {
    const rows: Array<{ id: string }> = []
    fillRows(rows, ['a', 'a', 'a'], id => ({ id }))
    expect(rows.map(row => row.id)).toEqual(['a'])
  })

  it('leaves the list untouched when there are no candidates', () => {
    const rows = [{ id: 'a' }]
    fillRows(rows, [], id => ({ id }))
    expect(rows.map(row => row.id)).toEqual(['a'])
  })
})
