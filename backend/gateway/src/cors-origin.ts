/**
 * CORS origin matching helpers.
 *
 * CORS_ORIGIN is a comma separated list whose entries can be:
 *   - an exact origin, e.g. https://recho.sansenjian.asia
 *   - a glob, e.g. https://*.example.com  (* never crosses a dot)
 *   - an explicit regular expression prefixed with re:, e.g.
 *     re:^https://recho-[a-z0-9-]+-team\.vercel\.app$
 *
 * Globs and regular expressions exist because Vercel hands every preview and
 * deployment a brand new hostname, so an exact allow-list can never cover them.
 */
export type CorsOriginMatcher = string | RegExp

const REGEX_PREFIX = 're:'

/**
 * A glob star widens exactly one host label, so https://*.a.com can never be
 * satisfied by https://x.a.com.evil.test.
 */
const WILDCARD_PATTERN = '[^.]*'

const REGEXP_SPECIAL = /[.*+?^$()|[\]{}\\-]/g

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL, '\\$&')
}

export function toCorsOriginMatcher(entry: string): CorsOriginMatcher | null {
  const value = entry.trim()
  if (!value) return null

  if (value.startsWith(REGEX_PREFIX)) {
    const body = value.slice(REGEX_PREFIX.length).trim()
    return body ? new RegExp(body) : null
  }

  if (value.includes('*')) {
    const pattern = value.split('*').map(escapeRegExp).join(WILDCARD_PATTERN)
    return new RegExp('^' + pattern + '$')
  }

  return value
}

const WHITESPACE = /\s/

/**
 * Splits the comma separated list while leaving the commas that belong to a
 * re: entry's regular expression source alone: an escaped comma (\x2c written
 * as a backslash followed by a comma), a comma inside a character class
 * ([a,b]) and a comma inside a quantifier ({1,32}) all stay in the pattern.
 *
 * A literal comma in a regular expression therefore has to be escaped like
 * any other literal comma would be written inside the pattern.
 */
export function splitCorsOriginEntries(raw: string): string[] {
  const entries: string[] = []
  let start = 0
  let pendingStart = true
  let regexEntry = false
  let escaped = false
  let inCharacterClass = false
  let quantifierDepth = 0

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]

    if (pendingStart) {
      if (WHITESPACE.test(character)) {
        start = index + 1
        continue
      }
      regexEntry = raw.startsWith(REGEX_PREFIX, index)
      pendingStart = false
    }

    if (regexEntry) {
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (inCharacterClass) {
        if (character === ']') inCharacterClass = false
        continue
      }
      if (character === '[') {
        inCharacterClass = true
        continue
      }
      if (character === '{') {
        quantifierDepth += 1
        continue
      }
      if (character === '}') {
        quantifierDepth = Math.max(0, quantifierDepth - 1)
        continue
      }
      if (character !== ',' || quantifierDepth > 0) continue
    } else if (character !== ',') {
      continue
    }

    entries.push(raw.slice(start, index))
    start = index + 1
    pendingStart = true
    regexEntry = false
    escaped = false
    inCharacterClass = false
    quantifierDepth = 0
  }

  entries.push(raw.slice(start))
  return entries
}

export function parseCorsOrigins(raw: string): CorsOriginMatcher[] {
  return splitCorsOriginEntries(raw)
    .map(toCorsOriginMatcher)
    .filter((entry): entry is CorsOriginMatcher => entry !== null)
}

export function isCorsOriginAllowed(origin: string | null | undefined, allowed: CorsOriginMatcher[]): boolean {
  if (!origin) return false
  return allowed.some((entry) => (entry instanceof RegExp ? entry.test(origin) : entry === origin))
}
