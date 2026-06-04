import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUTH_REDIRECT_PATH, safeSameOriginPath } from '../src/utils/authRedirect'

function setWindowOrigin(origin = 'https://recho.sansenjian.asia') {
  vi.stubGlobal('window', {
    location: { origin },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auth redirect helpers', () => {
  it('uses the default image workspace when no redirect is provided', () => {
    setWindowOrigin()

    expect(safeSameOriginPath(null)).toBe(DEFAULT_AUTH_REDIRECT_PATH)
  })

  it('keeps same-origin paths with query and hash fragments', () => {
    setWindowOrigin()

    expect(safeSameOriginPath('/works?page=2#image-1')).toBe('/works?page=2#image-1')
  })

  it('normalizes same-origin absolute URLs back to paths', () => {
    setWindowOrigin()

    expect(safeSameOriginPath('https://recho.sansenjian.asia/image?mode=canvas')).toBe(
      '/image?mode=canvas',
    )
  })

  it('rejects cross-origin and invalid redirect values', () => {
    setWindowOrigin()

    expect(safeSameOriginPath('https://evil.example/image')).toBe(DEFAULT_AUTH_REDIRECT_PATH)
    expect(safeSameOriginPath('http://[')).toBe(DEFAULT_AUTH_REDIRECT_PATH)
  })
})
