import { describe, expect, it } from 'vitest'
import {
  imageCreditCost,
  imageCreditCostForModel,
  normalizeImageCreditCostPerImage,
  normalizeImageModelCreditCosts,
  resolveImageCreditCostPerImage,
} from '../backend/gateway/src/services/image-credit-cost'

describe('image credit cost helpers', () => {
  it('defaults invalid per-image cost to one credit', () => {
    expect(normalizeImageCreditCostPerImage(undefined)).toBe(1)
    expect(normalizeImageCreditCostPerImage('')).toBe(1)
    expect(normalizeImageCreditCostPerImage(0)).toBe(1)
    expect(normalizeImageCreditCostPerImage(-3)).toBe(1)
  })

  it('keeps configured per-image cost at two decimal places with a 0.01 minimum', () => {
    expect(normalizeImageCreditCostPerImage(0.01)).toBe(0.01)
    expect(normalizeImageCreditCostPerImage('0.015')).toBe(0.02)
    expect(normalizeImageCreditCostPerImage(2.345)).toBe(2.35)
  })

  it('multiplies requested image count by configured per-image cost', () => {
    expect(imageCreditCost(1, 3)).toBe(3)
    expect(imageCreditCost(2, 3)).toBe(6)
    expect(imageCreditCost(8, 2)).toBe(16)
    expect(imageCreditCost(4, 0.01)).toBe(0.04)
    expect(imageCreditCost(3, 0.015)).toBe(0.06)
  })

  it('falls back to one requested image for malformed counts', () => {
    expect(imageCreditCost(undefined, 4)).toBe(4)
    expect(imageCreditCost('bad', 4)).toBe(4)
    expect(imageCreditCost(0, 4)).toBe(4)
  })
})

describe('per-model image pricing', () => {
  it('parses model price rows and rounds costs to two decimals', () => {
    expect(normalizeImageModelCreditCosts([
      { id: 'gpt-image-2', cost: 3 },
      { id: 'flux-pro', cost: '1.5' },
      { id: 'tiny', cost: 0.015 },
    ])).toEqual([
      { id: 'gpt-image-2', cost: 3 },
      { id: 'flux-pro', cost: 1.5 },
      { id: 'tiny', cost: 0.02 },
    ])
  })

  it('drops invalid rows instead of clamping them to a default price', () => {
    // 关键取舍：非法行 = 「没有覆盖价」，必须消失并回退兜底价。
    // 若钳成默认价，一次手滑会静默改变某个模型的真实计费。
    expect(normalizeImageModelCreditCosts([
      { id: 'good', cost: 2 },
      { id: '', cost: 5 },
      { id: '   ', cost: 5 },
      { id: 'has space', cost: 5 },
      { id: 'zero', cost: 0 },
      { id: 'negative', cost: -3 },
      { id: 'notanumber', cost: 'nope' },
      { cost: 9 },
      null,
      'nope',
    ])).toEqual([{ id: 'good', cost: 2 }])
  })

  it('keeps the first row when a model is priced more than once', () => {
    expect(normalizeImageModelCreditCosts([{ id: 'dup', cost: 2 }, { id: 'dup', cost: 9 }]))
      .toEqual([{ id: 'dup', cost: 2 }])
  })

  it('accepts the JSON string form stored in app_settings', () => {
    expect(normalizeImageModelCreditCosts('[{"id":"wrapped","cost":4}]'))
      .toEqual([{ id: 'wrapped', cost: 4 }])
    expect(normalizeImageModelCreditCosts('not json')).toEqual([])
  })

  it('returns an empty list for empty or structurally wrong input', () => {
    expect(normalizeImageModelCreditCosts(undefined)).toEqual([])
    expect(normalizeImageModelCreditCosts(null)).toEqual([])
    expect(normalizeImageModelCreditCosts([])).toEqual([])
    expect(normalizeImageModelCreditCosts({ id: 'x', cost: 1 })).toEqual([])
  })

  it('looks up a model price and reports a miss as null', () => {
    const costs = [{ id: 'gpt-image-2', cost: 3 }]

    expect(imageCreditCostForModel('gpt-image-2', costs)).toBe(3)
    expect(imageCreditCostForModel(' gpt-image-2 ', costs)).toBe(3)
    expect(imageCreditCostForModel('unlisted', costs)).toBeNull()
    expect(imageCreditCostForModel('', costs)).toBeNull()
  })

  it('prefers the model price and falls back to the default price', () => {
    const costs = [{ id: 'gpt-image-2', cost: 3 }]

    expect(resolveImageCreditCostPerImage('gpt-image-2', costs, 0.75)).toBe(3)
    expect(resolveImageCreditCostPerImage('unlisted', costs, 0.75)).toBe(0.75)
    // 没有配置覆盖价时也不能变成 0：兜底价本身要经过归一化。
    expect(resolveImageCreditCostPerImage('unlisted', [], 'bad')).toBe(1)
  })
})
