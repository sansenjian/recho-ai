import { describe, expect, it } from 'vitest'
import {
  imageCreditCost,
  normalizeImageCreditCostPerImage,
} from '../backend/gateway/src/services/image-credit-cost'

describe('image credit cost helpers', () => {
  it('defaults invalid per-image cost to one credit', () => {
    expect(normalizeImageCreditCostPerImage(undefined)).toBe(1)
    expect(normalizeImageCreditCostPerImage('')).toBe(1)
    expect(normalizeImageCreditCostPerImage(0)).toBe(1)
    expect(normalizeImageCreditCostPerImage(-3)).toBe(1)
  })

  it('rounds configured per-image cost to a positive integer', () => {
    expect(normalizeImageCreditCostPerImage(2.4)).toBe(2)
    expect(normalizeImageCreditCostPerImage('2.6')).toBe(3)
  })

  it('multiplies requested image count by configured per-image cost', () => {
    expect(imageCreditCost(1, 3)).toBe(3)
    expect(imageCreditCost(2, 3)).toBe(6)
    expect(imageCreditCost(8, 2)).toBe(16)
  })

  it('falls back to one requested image for malformed counts', () => {
    expect(imageCreditCost(undefined, 4)).toBe(4)
    expect(imageCreditCost('bad', 4)).toBe(4)
    expect(imageCreditCost(0, 4)).toBe(4)
  })
})
