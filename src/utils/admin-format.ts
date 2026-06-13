import type {
  AdminImageAttemptItem,
  AdminImageItem,
  AdminSystemTableStatus,
} from '../types/admin'

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
  return visibility === 'private' ? '已隐藏' : '公开'
}

export function imageFundingLabel(image: AdminImageItem) {
  if (image.fundingSource === 'credit') return '额度'
  if (image.fundingSource === 'free') return '免费'
  return '-'
}

export function imagePreviewSrc(image: AdminImageItem) {
  return image.thumbnailUrl || image.previewUrl || undefined
}

export function imageDetails(image: AdminImageItem) {
  const parts = [
    image.quality ? `质量 ${image.quality}` : '',
    image.resolution ? `分辨率 ${image.resolution}` : '',
    image.size ? `尺寸 ${image.size}` : '',
    image.aspectRatio ? `比例 ${image.aspectRatio}` : '',
    image.creditCost > 0 ? `${image.creditCost} 额度` : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '-'
}

export function attemptStatusLabel(status: AdminImageAttemptItem['status']) {
  return status === 'succeeded' ? '成功' : '失败'
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

export function tableStatusLabel(status: AdminSystemTableStatus['status']) {
  if (status === 'ok') return '正常'
  if (status === 'missing') return '缺失'
  if (status === 'restricted') return '受限'
  if (status === 'unavailable') return '未配置'
  return '异常'
}
