export const DEFAULT_AUTH_REDIRECT_PATH = '/image'

export function safeSameOriginPath(
  value: string | null,
  fallback = DEFAULT_AUTH_REDIRECT_PATH,
) {
  if (!value) return fallback

  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return fallback
    return `${url.pathname}${url.search}${url.hash}` || fallback
  } catch {
    return fallback
  }
}
