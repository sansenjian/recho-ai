import { describe, expect, it, vi } from 'vitest'

vi.mock('../backend/gateway/src/config', () => ({
  PROVIDER_API_KEY_MASTER_KEY: '0123456789abcdef0123456789abcdef',
}))

describe('secret crypto', () => {
  it('encrypts API keys with AES-GCM and decrypts them in memory', async () => {
    const { decryptSecret, encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')

    const ciphertext = encryptSecret('sk-test-secret-value')

    expect(ciphertext).toMatch(/^v1\.aes-256-gcm\./)
    expect(ciphertext).not.toContain('sk-test-secret-value')
    expect(decryptSecret(ciphertext)).toBe('sk-test-secret-value')
  })
})
