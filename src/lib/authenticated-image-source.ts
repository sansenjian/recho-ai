import { getAuthIdentity } from '../composables/useAuthSession'
import { imageApiUrl } from './api-base'
import { ANONYMOUS_OWNER, imageBlobCacheKey, readImageBlob, writeImageBlob } from './image-blob-cache'

export type AuthenticatedImageMode = 'thumbnail' | 'preview' | 'original'

export interface AuthenticatedImageSource {
  dataUrl?: string
  url?: string
  temporaryUrl?: string
  imageUrl?: string
  previewUrl?: string
  thumbnailUrl?: string
  storagePath?: string
  previewPath?: string
  thumbnailPath?: string
}

const urlPriority: Record<AuthenticatedImageMode, Array<keyof AuthenticatedImageSource>> = {
  thumbnail: ['thumbnailUrl', 'previewUrl', 'dataUrl', 'imageUrl', 'temporaryUrl', 'url'],
  preview: ['previewUrl', 'thumbnailUrl', 'dataUrl', 'imageUrl', 'temporaryUrl', 'url'],
  original: ['imageUrl', 'dataUrl', 'url', 'temporaryUrl', 'previewUrl', 'thumbnailUrl'],
}

const storagePathPriority: Record<AuthenticatedImageMode, Array<keyof AuthenticatedImageSource>> = {
  thumbnail: ['thumbnailPath', 'previewPath', 'storagePath'],
  preview: ['previewPath', 'thumbnailPath', 'storagePath'],
  original: ['storagePath', 'previewPath', 'thumbnailPath'],
}

function firstString(source: AuthenticatedImageSource | null | undefined, keys: Array<keyof AuthenticatedImageSource>) {
  if (!source) return ''
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

export function imageSourceUrl(
  source: AuthenticatedImageSource | null | undefined,
  mode: AuthenticatedImageMode = 'thumbnail',
) {
  return firstString(source, urlPriority[mode])
}

export function imageStoragePath(
  source: AuthenticatedImageSource | null | undefined,
  mode: AuthenticatedImageMode = 'thumbnail',
) {
  return firstString(source, storagePathPriority[mode])
}

export function imageStoragePathCandidates(
  source: AuthenticatedImageSource | null | undefined,
  mode: AuthenticatedImageMode = 'thumbnail',
) {
  if (!source) return []
  const candidates: string[] = []
  for (const key of storagePathPriority[mode]) {
    const value = source[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed)
    }
  }
  return candidates
}

export function hasImageSource(
  source: AuthenticatedImageSource | null | undefined,
  mode: AuthenticatedImageMode = 'thumbnail',
) {
  return Boolean(imageSourceUrl(source, mode) || imageStoragePath(source, mode))
}

export function imageStorageProxyUrl(storagePath: string) {
  return imageApiUrl(`/api/image/storage/${encodeURIComponent(storagePath)}`)
}

/**
 * 取回受保护图片的二进制内容。
 *
 * 下载与复制到剪贴板都需要 blob 本身，而不是一个 object URL——剪贴板要的是数据。
 * 两条路径共用这里，避免各写一份鉴权与错误处理。
 */
export async function fetchAuthenticatedImageBlob(
  storagePath: string,
  signal?: AbortSignal,
  mode: AuthenticatedImageMode = 'original',
) {
  // 身份要一次拿到手：缓存键用它隔离账号，请求头用它做鉴权。分两次取会在两次
  // 之间发生登录/登出时把 A 的图写进 B 的缓存。
  const identity = await getAuthIdentity()
  const owner = identity.userId || ANONYMOUS_OWNER

  // 先查本地缓存。断网时这是唯一能让图库显示出来的路径，所以即便后面网络失败也
  // 要先试缓存，而不是反过来。
  const cacheKey = imageBlobCacheKey(owner, storagePath, mode)
  const cached = await readImageBlob(cacheKey)
  if (cached) return cached

  const token = identity.accessToken
  const res = await fetch(imageStorageProxyUrl(storagePath), {
    cache: 'force-cache',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal,
  })
  if (!res.ok) {
    throw new Error(`image storage proxy returned ${res.status}`)
  }
  const blob = await res.blob()
  if (!blob.size) {
    throw new Error('image storage proxy returned empty body')
  }
  // 写回失败不该让已经拿到的图白拿，所以不 await 结果以外的错误。
  void writeImageBlob(cacheKey, blob)
  return blob
}

export async function fetchAuthenticatedImageObjectUrl(
  storagePath: string,
  signal?: AbortSignal,
  mode: AuthenticatedImageMode = 'original',
) {
  const blob = await fetchAuthenticatedImageBlob(storagePath, signal, mode)
  return URL.createObjectURL(blob)
}
