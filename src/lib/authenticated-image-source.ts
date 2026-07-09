import { getAuthAccessToken } from '../composables/useAuthSession'
import { imageApiUrl } from './api-base'

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

export function hasImageSource(
  source: AuthenticatedImageSource | null | undefined,
  mode: AuthenticatedImageMode = 'thumbnail',
) {
  return Boolean(imageSourceUrl(source, mode) || imageStoragePath(source, mode))
}

export function imageStorageProxyUrl(storagePath: string) {
  return imageApiUrl(`/api/image/storage/${encodeURIComponent(storagePath)}`)
}

export async function fetchAuthenticatedImageObjectUrl(storagePath: string, signal?: AbortSignal) {
  const token = await getAuthAccessToken()
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
  return URL.createObjectURL(blob)
}
