import { describe, expect, it } from 'vitest'
import { numericBalance } from '../src/composables/useCredits'
import { formatCreditAmount, formatSignedCreditAmount } from '../src/utils/credit-format'

describe('useCredits helpers', () => {
  it('preserves decimal credit balances instead of rounding to whole credits', () => {
    expect(numericBalance(29.9)).toBe(29.9)
    expect(numericBalance('29.91')).toBe(29.91)
    expect(numericBalance('29.999')).toBe(30)
    expect(numericBalance(1.005)).toBe(1.01)
    expect(numericBalance(1e-7)).toBe(0)
  })

  it('normalizes malformed or negative balances safely', () => {
    expect(numericBalance(-0.1)).toBe(0)
    expect(numericBalance('bad')).toBeNull()
  })

  it('formats credit amounts consistently', () => {
    expect(formatCreditAmount(29.9)).toBe('29.9')
    expect(formatCreditAmount(1.005)).toBe('1.01')
    expect(formatSignedCreditAmount(0.1)).toBe('+0.1')
    expect(formatSignedCreditAmount(-0.1)).toBe('-0.1')
  })
})
