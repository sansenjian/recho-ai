import { describe, expect, it } from 'vitest'
import { CreditError } from '../backend/gateway/src/services/credit-error'

describe('CreditError', () => {
  it('exposes a stable code for control flow independently of message text', () => {
    const error = new CreditError('insufficient_credits')
    error.message = 'localized message'

    expect(error.code).toBe('insufficient_credits')
    expect(error.status).toBe(402)
  })

  it('maps credit_operation_failed to status 500', () => {
    const error = new CreditError('credit_operation_failed')

    expect(error.code).toBe('credit_operation_failed')
    expect(error.status).toBe(500)
  })
})
