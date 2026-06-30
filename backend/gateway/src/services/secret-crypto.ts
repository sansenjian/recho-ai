import crypto from 'node:crypto'
import { PROVIDER_API_KEY_MASTER_KEY } from '../config.js'

const SECRET_PREFIX = 'v1.aes-256-gcm'

export class SecretCryptoError extends Error {
  constructor(code: string) {
    super(code)
  }
}

function base64UrlEncode(buffer: Buffer) {
  return buffer.toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url')
}

function decodeMasterKey(rawKey = PROVIDER_API_KEY_MASTER_KEY) {
  const value = rawKey.trim()
  if (!value) {
    throw new SecretCryptoError('provider_api_key_master_key_missing')
  }

  const normalized = value.startsWith('base64:') ? value.slice('base64:'.length) : value
  const candidates: Buffer[] = []

  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    candidates.push(Buffer.from(normalized, 'hex'))
  }

  try {
    candidates.push(Buffer.from(normalized, 'base64url'))
  } catch {
    // Try the next format.
  }

  try {
    candidates.push(Buffer.from(normalized, 'base64'))
  } catch {
    // Try the next format.
  }

  candidates.push(Buffer.from(normalized, 'utf8'))

  const key = candidates.find(candidate => candidate.length === 32)
  if (!key) {
    throw new SecretCryptoError('provider_api_key_master_key_invalid')
  }
  return key
}

export function encryptSecret(plaintext: string) {
  const value = plaintext.trim()
  if (!value) return null

  const key = decodeMasterKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    SECRET_PREFIX,
    base64UrlEncode(iv),
    base64UrlEncode(tag),
    base64UrlEncode(ciphertext),
  ].join('.')
}

export function decryptSecret(ciphertext: unknown) {
  if (typeof ciphertext !== 'string' || !ciphertext.trim()) return ''
  const parts = ciphertext.split('.')
  if (parts.length !== 5 || `${parts[0]}.${parts[1]}` !== SECRET_PREFIX) {
    throw new SecretCryptoError('provider_api_key_ciphertext_invalid')
  }

  const key = decodeMasterKey()
  const iv = base64UrlDecode(parts[2])
  const tag = base64UrlDecode(parts[3])
  const encrypted = base64UrlDecode(parts[4])
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export function isSecretCryptoConfigured() {
  try {
    decodeMasterKey()
    return true
  } catch {
    return false
  }
}

export function publicSecretCryptoError(error: unknown) {
  if (!(error instanceof SecretCryptoError)) return 'API Key 加密失败，请稍后重试。'
  if (error.message === 'provider_api_key_master_key_missing') {
    return '缺少 PROVIDER_API_KEY_MASTER_KEY，无法保存 API Key。'
  }
  if (error.message === 'provider_api_key_master_key_invalid') {
    return 'PROVIDER_API_KEY_MASTER_KEY 必须是 32 字节密钥、base64 或 64 位 hex。'
  }
  return 'API Key 密文无效，请重新保存 Provider Key。'
}
