import { describe, expect, it } from 'vitest'
import { publicErrorMessage, redactSensitiveText, safeErrorDetail } from '../backend/gateway/src/services/safe-error'

describe('gateway safe error helpers', () => {
  it('redacts secrets, bearer tokens, URLs, and long opaque values', () => {
    const text = [
      'failed at https://secret-provider.example.com/v1/images',
      'Authorization: Bearer token_should_not_be_visible_1234567890',
      'api_key=sk-supersecretvalue1234567890',
      'trace=abcdef1234567890abcdef1234567890',
    ].join(' ')

    const redacted = redactSensitiveText(text)

    expect(redacted).not.toContain('secret-provider.example.com')
    expect(redacted).not.toContain('https://')
    expect(redacted).not.toContain('token_should_not_be_visible')
    expect(redacted).not.toContain('sk-supersecretvalue')
    expect(redacted).not.toContain('abcdef1234567890abcdef1234567890')
    expect(redacted).toContain('[redacted-url]')
    expect(redacted).toContain('[redacted-secret]')
  })

  it('returns public-safe timeout and provider failure messages', () => {
    expect(publicErrorMessage(Object.assign(new Error('upstream timed out at https://x.example'), { status: 524 })))
      .toBe('服务响应超时，请稍后重试。')
    expect(publicErrorMessage(Object.assign(new Error('bad key sk-secret'), { status: 401 })))
      .toBe('服务暂时无法处理该请求，请稍后重试。')
  })

  it('keeps diagnostic details redacted for logs and stored attempts', () => {
    const detail = safeErrorDetail(new Error('provider https://hidden.example failed with Bearer abc.def.ghi'))

    expect(detail).not.toContain('hidden.example')
    expect(detail).not.toContain('abc.def.ghi')
    expect(detail).toContain('[redacted-url]')
    expect(detail).toContain('[redacted-secret]')
  })
})
