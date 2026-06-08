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

export function originalStorageImageUrl(storagePath?: string, ...sourceUrls: Array<string | undefined>) {
  if (!storagePath) return ''
  for (const sourceUrl of sourceUrls) {
    if (!sourceUrl || /^data:/i.test(sourceUrl)) continue
    try {
      const url = new URL(sourceUrl, window.location.href)
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
