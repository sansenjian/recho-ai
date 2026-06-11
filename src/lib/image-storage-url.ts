export interface StorageImageLike {
  dataUrl?: string
  storagePath?: string
  previewUrl?: string
  thumbnailUrl?: string
}

export function encodedStoragePath(storagePath: string) {
  return storagePath
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/')
}

function cosStorageKey(storagePath: string) {
  return storagePath.startsWith('cos://')
    ? storagePath.slice('cos://'.length).replace(/^\/+/, '')
    : ''
}

export function originalStorageImageUrl(storagePath?: string, ...sourceUrls: Array<string | undefined>) {
  if (!storagePath) return ''
  const cosKey = cosStorageKey(storagePath)
  for (const sourceUrl of sourceUrls) {
    if (!sourceUrl || /^data:/i.test(sourceUrl)) continue
    try {
      const url = new URL(sourceUrl, window.location.href)
      if (cosKey) {
        const previewKey = cosKey.replace(/\.[a-z0-9]+$/i, '.preview.webp')
        const thumbnailKey = cosKey.replace(/\.[a-z0-9]+$/i, '.thumb.webp')
        const decodedPath = decodeURIComponent(url.pathname)
        const matchedKey = [previewKey, thumbnailKey, cosKey].find(key => decodedPath.endsWith(`/${key}`))
        const encodedMatchedKey = matchedKey ? encodedStoragePath(matchedKey) : ''
        url.pathname = matchedKey
          ? `${url.pathname.slice(0, Math.max(1, url.pathname.length - encodedMatchedKey.length))}${encodedStoragePath(cosKey)}`
          : `/${encodedStoragePath(cosKey)}`
        url.search = ''
        return url.toString()
      }

      const marker = '/storage/v1/object/public/'
      const markerIndex = url.pathname.indexOf(marker)
      if (markerIndex < 0) continue

      const pathStart = markerIndex + marker.length
      const bucket = url.pathname.slice(pathStart).split('/')[0]
      if (!bucket) continue

      url.pathname = `${url.pathname.slice(0, pathStart)}${bucket}/${encodedStoragePath(storagePath)}`
      url.search = ''
      return url.toString()
    } catch {
      // Non-URL data is handled by the normal detail fallback.
    }
  }
  return ''
}

export function originalImageDownloadUrl(image: StorageImageLike) {
  return originalStorageImageUrl(
    image.storagePath,
    image.dataUrl,
    image.previewUrl,
    image.thumbnailUrl,
  ) || image.dataUrl || ''
}
