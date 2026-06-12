import { describe, expect, it } from 'vitest'
import { numericBalance } from '../src/composables/useCredits'

describe('useCredits helpers', () => {
  it('preserves decimal credit balances instead of rounding to whole credits', () => {
    expect(numericBalance(29.9)).toBe(29.9)
    expect(numericBalance('29.91')).toBe(29.91)
    expect(numericBalance('29.999')).toBe(30)
  })

  it('normalizes malformed or negative balances safely', () => {
    expect(numericBalance(-0.1)).toBe(0)
    expect(numericBalance('bad')).toBeNull()
  })
})
