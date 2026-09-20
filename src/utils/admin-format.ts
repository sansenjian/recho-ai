import i18n from '../i18n'
import type {
  AdminImageAttemptItem,
  AdminImageItem,
  AdminSystemTableStatus,
} from '../types/admin'

const t = i18n.global.t

export function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

export function dateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function imageVisibilityLabel(visibility: AdminImageItem['visibility']) {
  return visibility === 'private' ? t('images.hidden') : t('images.public')
}

export function imageFundingLabel(image: AdminImageItem) {
  if (image.fundingSource === 'credit') return t('images.credit')
  if (image.fundingSource === 'free') return t('images.free')
  return '-'
}

export function imagePreviewSrc(image: AdminImageItem) {
  return image.thumbnailUrl || image.previewUrl || undefined
}

export function imageDetails(image: AdminImageItem) {
  const parts = [
    image.quality ? t('genDetails.quality', { value: image.quality }) : '',
    image.resolution ? t('genDetails.resolution', { value: image.resolution }) : '',
    image.size ? t('genDetails.size', { value: image.size }) : '',
    image.aspectRatio ? t('genDetails.aspectRatio', { value: image.aspectRatio }) : '',
    image.creditCost > 0 ? t('genDetails.credits', { cost: image.creditCost }) : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '-'
}

export function attemptStatusLabel(status: AdminImageAttemptItem['status']) {
  return status === 'succeeded' ? t('monitor.succeeded') : t('monitor.failed')
}

export function latencyLabel(value: number | null) {
  if (value === null) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`
  return `${value}ms`
}

export function attemptErrorSummary(attempt: AdminImageAttemptItem) {
  const parts = [
    attempt.errorType || '',
    attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : '',
    attempt.errorCode || '',
    attempt.errorMessage || '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '-'
}

export function storageLocationLabel(location: AdminImageItem['storageLocation']) {
  if (location === 'cos') return t('images.cos')
  if (location === 'supabase') return t('images.supabase')
  if (location === 'data') return t('images.data')
  return '-'
}

export function storageLocationClass(location: AdminImageItem['storageLocation']) {
  if (location === 'cos') return 'storage-cos'
  if (location === 'supabase') return 'storage-supabase'
  if (location === 'data') return 'storage-data'
  return ''
}

export function tableStatusLabel(status: AdminSystemTableStatus['status']) {
  if (status === 'ok') return t('system.tableStatus.ok')
  if (status === 'missing') return t('system.tableStatus.missing')
  if (status === 'restricted') return t('system.tableStatus.restricted')
  if (status === 'unavailable') return t('system.tableStatus.unconfigured')
  return t('system.tableStatus.error')
}
