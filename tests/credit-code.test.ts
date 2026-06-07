import { describe, expect, it } from 'vitest'
import {
  createRandomCreditCode,
  creditCodeHash,
  normalizeCreditCode,
  normalizeCreditCodePrefix,
} from '../backend/gateway/src/services/credit-code'

describe('credit code helpers', () => {
  it('normalizes user-entered codes before hashing', () => {
    expect(normalizeCreditCode(' recho-2026 test-100 ')).toBe('RECHO2026TEST100')
    expect(creditCodeHash('RECHO-2026-TEST-100')).toBe(creditCodeHash(' recho 2026 test 100 '))
  })

  it('creates readable random codes with a normalized prefix', () => {
    const code = createRandomCreditCode(' recho-活动 ')

    expect(normalizeCreditCodePrefix(' recho-活动 ')).toBe('RECHO')
    expect(code).toMatch(/^RECHO-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  })
})
