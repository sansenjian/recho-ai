const DEFAULT_IMAGE_CREDIT_COST_PER_IMAGE = 1
const MIN_IMAGE_CREDIT_COST_PER_IMAGE = 0.01
const CREDIT_AMOUNT_PRECISION = 100
const MAX_CREDIT_COST_MODEL_ID_LENGTH = 120
const MAX_CREDIT_COST_MODEL_ENTRIES = 200

export interface ImageModelCreditCostEntry {
  id: string
  cost: number
}

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

/** 模型 id 与 normalizeModelName 用同一套字符集，避免存进永远匹配不上的 id。 */
function normalizeCreditCostModelId(value: unknown) {
  if (typeof value !== 'string') return ''
  const id = value.trim()
  if (!id || id.length > MAX_CREDIT_COST_MODEL_ID_LENGTH) return ''
  return /^[a-zA-Z0-9._:/-]+$/.test(id) ? id : ''
}

/**
 * 归一化「按模型定价」表：`[{ id, cost }]`。
 *
 * 与 `normalizeImageCreditCostPerImage` 的取舍**故意不同**：这里单项非法
 * （非数字、低于下限）意味着「没有覆盖价」，于是直接丢弃该项、让它回退到兜底价；
 * 而**不是**把非法值钳成默认价——否则一次手滑的输入会静默改变某个模型的真实计费。
 *
 * 因此空数组是合法结果（表示没有任何覆盖价），不要像 availableImageModels 那样回退 fallback。
 */
export function normalizeImageModelCreditCosts(value: unknown): ImageModelCreditCostEntry[] {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(parsed)) return []

  const result: ImageModelCreditCostEntry[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (item == null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = normalizeCreditCostModelId(record.id)
    // 同一个模型出现多次时以第一条为准，避免保存顺序决定实际计费。
    if (!id || seen.has(id)) continue
    const cost = Number(record.cost)
    if (!Number.isFinite(cost) || cost < MIN_IMAGE_CREDIT_COST_PER_IMAGE) continue
    seen.add(id)
    result.push({ id, cost: roundCreditAmount(cost) })
    if (result.length >= MAX_CREDIT_COST_MODEL_ENTRIES) break
  }
  return result
}

/** 取某模型的覆盖价；没有覆盖价时返回 null，由调用方回退兜底价。 */
export function imageCreditCostForModel(model: unknown, costs: unknown): number | null {
  const id = normalizeCreditCostModelId(model)
  if (!id) return null
  const entry = normalizeImageModelCreditCosts(costs).find(item => item.id === id)
  return entry ? entry.cost : null
}

/**
 * 计算某次生成应使用的单价：命中模型覆盖价就用它，否则用兜底价。
 *
 * `model` 必须是**实际用于该次生成的模型**（用户所选，或所选 Provider 的默认生图/编辑模型），
 * 否则会出现「显示价 ≠ 扣费价」。
 */
export function resolveImageCreditCostPerImage(model: unknown, costs: unknown, fallbackCostPerImage: unknown) {
  return imageCreditCostForModel(model, costs) ?? normalizeImageCreditCostPerImage(fallbackCostPerImage)
}
