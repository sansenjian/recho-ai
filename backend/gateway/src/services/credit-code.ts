import { createHash, randomInt } from 'node:crypto'

const MAX_CODE_LENGTH = 120
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function normalizeCreditCode(value: unknown) {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase()
    .slice(0, MAX_CODE_LENGTH)
}

export function creditCodeHash(value: unknown) {
  const normalized = normalizeCreditCode(value)
  if (!normalized) return ''
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

export function normalizeCreditCodePrefix(value: unknown) {
  const prefix = normalizeCreditCode(value).replace(/[^A-Z0-9]/g, '')
  return prefix.slice(0, 24) || 'RECHO'
}

function randomCodeChunk(length: number) {
  let chunk = ''
  for (let index = 0; index < length; index += 1) {
    chunk += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return chunk
}

export function createRandomCreditCode(prefix: unknown) {
  const normalizedPrefix = normalizeCreditCodePrefix(prefix)
  return [
    normalizedPrefix,
    randomCodeChunk(4),
    randomCodeChunk(4),
    randomCodeChunk(4),
  ].join('-')
}
