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

export function parseCorsOrigins(raw: string): CorsOriginMatcher[] {
  return raw
    .split(',')
    .map(toCorsOriginMatcher)
    .filter((entry): entry is CorsOriginMatcher => entry !== null)
}

export function isCorsOriginAllowed(origin: string | null | undefined, allowed: CorsOriginMatcher[]): boolean {
  if (!origin) return false
  return allowed.some((entry) => (entry instanceof RegExp ? entry.test(origin) : entry === origin))
}
