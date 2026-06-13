const DEFAULT_IMAGE_CREDIT_COST_PER_IMAGE = 1
const MIN_IMAGE_CREDIT_COST_PER_IMAGE = 0.01
const CREDIT_AMOUNT_PRECISION = 100

export function roundCreditAmount(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.round(number * CREDIT_AMOUNT_PRECISION) / CREDIT_AMOUNT_PRECISION
}

export function normalizeImageCreditCostPerImage(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < MIN_IMAGE_CREDIT_COST_PER_IMAGE) {
    return DEFAULT_IMAGE_CREDIT_COST_PER_IMAGE
  }
  return roundCreditAmount(number)
}

export function imageCreditCost(imageCount: unknown, costPerImage: unknown) {
  const count = Number(imageCount)
  const normalizedCount = Number.isFinite(count) && count > 0 ? Math.round(count) : 1
  return roundCreditAmount(Math.max(1, normalizedCount) * normalizeImageCreditCostPerImage(costPerImage))
}
