import type { ImageAspectRatio } from '../types/image'

export const PRESET_IMAGE_ASPECT_RATIOS = new Set<ImageAspectRatio>([
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '16:9',
  '9:16',
])

const MIN_ASPECT_RATIO = 1 / 3
const MAX_ASPECT_RATIO = 3
const MAX_RATIO_PART = 1000

export interface ImageAspectRatioParts {
  width: number
  height: number
  value: ImageAspectRatio
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a || 1
}

export function parseImageAspectRatio(value: string): ImageAspectRatioParts | null {
  const match = /^\s*(\d{1,4})\s*:\s*(\d{1,4})\s*$/.exec(value)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_RATIO_PART ||
    height > MAX_RATIO_PART
  ) return null

  const ratio = width / height
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) return null

  const divisor = greatestCommonDivisor(width, height)
  const normalizedWidth = width / divisor
  const normalizedHeight = height / divisor
  return {
    width: normalizedWidth,
    height: normalizedHeight,
    value: `${normalizedWidth}:${normalizedHeight}` as ImageAspectRatio,
  }
}

export function isCustomImageAspectRatio(value?: ImageAspectRatio | string | null): boolean {
  if (!value) return false
  const parsed = parseImageAspectRatio(String(value))
  return Boolean(parsed && !PRESET_IMAGE_ASPECT_RATIOS.has(parsed.value))
}
