import { describe, expect, it } from 'vitest'
import { CreditOperationError } from '../backend/gateway/src/services/credits'

describe('CreditOperationError', () => {
  it('exposes a stable code for control flow independently of message text', () => {
    const error = new CreditOperationError('insufficient_credits')
    error.message = 'localized message'

    expect(error.code).toBe('insufficient_credits')
    expect(error.status).toBe(402)
  })
})
