const DEFAULT_IMAGE_CREDIT_COST_PER_IMAGE = 1

export function normalizeImageCreditCostPerImage(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_IMAGE_CREDIT_COST_PER_IMAGE
  return Math.max(DEFAULT_IMAGE_CREDIT_COST_PER_IMAGE, Math.round(number))
}

export function imageCreditCost(imageCount: unknown, costPerImage: unknown) {
  const count = Number(imageCount)
  const normalizedCount = Number.isFinite(count) && count > 0 ? Math.round(count) : 1
  return Math.max(1, normalizedCount) * normalizeImageCreditCostPerImage(costPerImage)
}
