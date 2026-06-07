function isLocalDevHost() {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(window.location.hostname)
}

export function apiBaseUrl() {
  if (import.meta.env.DEV && isLocalDevHost() && import.meta.env.VITE_FORCE_REMOTE_API !== 'true') {
    return ''
  }

  return String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
}

export function apiUrl(path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${apiBaseUrl()}${cleanPath}`
}
