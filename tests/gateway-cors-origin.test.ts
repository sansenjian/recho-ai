import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isCorsOriginAllowed, parseCorsOrigins, toCorsOriginMatcher } from '../backend/gateway/src/cors-origin'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const PRODUCTION_ORIGIN = 'https://recho-ai.vercel.app'
const BRANCH_PREVIEW_ORIGIN =
  'https://recho-ai-git-feat-workspace-chat-pa-4b55ff-sansenjians-projects.vercel.app'
const DEPLOYMENT_ORIGIN = 'https://recho-llp6fpcus-sansenjians-projects.vercel.app'

function renderYamlCorsOrigin(): string {
  const yaml = readFileSync(join(repoRoot, 'render.yaml'), 'utf8')
  const match = yaml.match(/- key: CORS_ORIGIN\s*\r?\n(?:\s*#[^\r\n]*\r?\n)*\s*value: '?([^'\r\n]*)'?/)
  if (!match) throw new Error('render.yaml is missing a CORS_ORIGIN value')
  return match[1]
}

describe('cors origin matching', () => {
  it('keeps exact origins working', () => {
    const origins = parseCorsOrigins('http://localhost:5173,https://recho.sansenjian.asia')

    expect(origins).toEqual(['http://localhost:5173', 'https://recho.sansenjian.asia'])
    expect(isCorsOriginAllowed('https://recho.sansenjian.asia', origins)).toBe(true)
    expect(isCorsOriginAllowed('https://recho.sansenjian.asia.evil.test', origins)).toBe(false)
    expect(isCorsOriginAllowed('https://evil.test', origins)).toBe(false)
  })

  it('drops blank entries and supports a single value default', () => {
    expect(parseCorsOrigins(' , ,http://localhost:5173,, ')).toEqual(['http://localhost:5173'])
    expect(parseCorsOrigins('')).toEqual([])
    expect(parseCorsOrigins('http://localhost:5173')).toEqual(['http://localhost:5173'])
  })

  it('turns a re: prefixed entry into a regular expression', () => {
    const matcher = toCorsOriginMatcher('re:^https://recho-[a-z0-9-]+-team\\.vercel\\.app$')

    expect(matcher).toBeInstanceOf(RegExp)
    expect(isCorsOriginAllowed('https://recho-abc123-team.vercel.app', [matcher!])).toBe(true)
    expect(isCorsOriginAllowed('https://recho-abc123-team.vercel.app.evil.test', [matcher!])).toBe(false)
    expect(isCorsOriginAllowed('https://evil-attacker-team.vercel.app', [matcher!])).toBe(false)
  })

  it('ignores a re: prefix without a body', () => {
    expect(toCorsOriginMatcher('re:')).toBeNull()
    expect(toCorsOriginMatcher('re:   ')).toBeNull()
  })

  it('expands a glob to a single host label and escapes regex metacharacters', () => {
    const matcher = toCorsOriginMatcher('https://recho-*.example.com')

    expect(matcher).toBeInstanceOf(RegExp)
    expect(isCorsOriginAllowed('https://recho-ai.example.com', [matcher!])).toBe(true)
    // the star must not swallow a dot, otherwise a registrable suffix escapes the allow-list
    expect(isCorsOriginAllowed('https://recho-a.b.example.com', [matcher!])).toBe(false)
    expect(isCorsOriginAllowed('https://recho-ai.example.com.evil.test', [matcher!])).toBe(false)
    expect(isCorsOriginAllowed('https://recho-aiexample.com', [matcher!])).toBe(false)
  })

  it('keeps commas that belong to a re: quantifier', () => {
    const origins = parseCorsOrigins(
      'https://a.example.com,re:^https://recho-[a-z]{1,32}\\.example\\.com$,https://b.example.com',
    )

    expect(origins).toHaveLength(3)
    expect(origins[0]).toBe('https://a.example.com')
    expect(origins[1]).toBeInstanceOf(RegExp)
    expect(String(origins[1])).toContain('{1,32}')
    expect(origins[2]).toBe('https://b.example.com')

    expect(isCorsOriginAllowed('https://recho-abc.example.com', origins)).toBe(true)
    expect(isCorsOriginAllowed('https://recho-.example.com', origins)).toBe(false)
    expect(isCorsOriginAllowed('https://a.example.com', origins)).toBe(true)
    expect(isCorsOriginAllowed('https://b.example.com', origins)).toBe(true)
  })

  it('keeps commas that belong to a re: character class or escape', () => {
    const classOrigins = parseCorsOrigins('re:^https://[a,b]\\.example\\.com$')

    expect(classOrigins).toHaveLength(1)
    expect(isCorsOriginAllowed('https://a.example.com', classOrigins)).toBe(true)
    expect(isCorsOriginAllowed('https://b.example.com', classOrigins)).toBe(true)
    expect(isCorsOriginAllowed('https://c.example.com', classOrigins)).toBe(false)

    const escapedOrigins = parseCorsOrigins('re:^https://a\\,b\\.example\\.com$,https://c.example.com')

    expect(escapedOrigins).toHaveLength(2)
    expect(isCorsOriginAllowed('https://a,b.example.com', escapedOrigins)).toBe(true)
    expect(isCorsOriginAllowed('https://c.example.com', escapedOrigins)).toBe(true)
  })

  it('rejects a missing origin', () => {
    const origins = parseCorsOrigins('https://recho.sansenjian.asia')

    expect(isCorsOriginAllowed(undefined, origins)).toBe(false)
    expect(isCorsOriginAllowed(null, origins)).toBe(false)
    expect(isCorsOriginAllowed('', origins)).toBe(false)
  })
})

describe('render.yaml CORS_ORIGIN allow-list', () => {
  it('covers the Vercel production alias, branch previews and deployment URLs', () => {
    const origins = parseCorsOrigins(renderYamlCorsOrigin())

    expect(isCorsOriginAllowed(PRODUCTION_ORIGIN, origins)).toBe(true)
    expect(isCorsOriginAllowed(BRANCH_PREVIEW_ORIGIN, origins)).toBe(true)
    expect(isCorsOriginAllowed(DEPLOYMENT_ORIGIN, origins)).toBe(true)
  })

  it('still allows the Render frontends and local development', () => {
    const origins = parseCorsOrigins(renderYamlCorsOrigin())

    expect(isCorsOriginAllowed('https://recho-ai.onrender.com', origins)).toBe(true)
    expect(isCorsOriginAllowed('https://recho.sansenjian.asia', origins)).toBe(true)
    expect(isCorsOriginAllowed('http://localhost:5173', origins)).toBe(true)
  })

  it('does not widen the allow-list to unrelated Vercel projects', () => {
    const origins = parseCorsOrigins(renderYamlCorsOrigin())

    expect(isCorsOriginAllowed('https://recho-ai.vercel.app.evil.test', origins)).toBe(false)
    expect(isCorsOriginAllowed('https://recho-evil.vercel.app', origins)).toBe(false)
    expect(isCorsOriginAllowed('https://evil.test', origins)).toBe(false)
    expect(isCorsOriginAllowed('https://evil-sansenjians-projects.vercel.app', origins)).toBe(false)
  })
})
