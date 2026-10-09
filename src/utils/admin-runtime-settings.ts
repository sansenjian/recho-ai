import type { AdminImageModelCreditCost } from '../types/admin'
import { normalizeCreditBalance } from './credit-format'

/** 运行时配置里「按模型定价」的一行。 */
export interface ModelPriceRow {
  id: string
  cost: number
}

/** 运行时配置里「用户可见模型」的一行。 */
export interface VisibleModelRow {
  id: string
  name: string
  supportsTransparent: boolean
}

/**
 * 从接口读到的可见模型行：能力位可能缺失（旧的 app_settings 行没有它），
 * 归一化时会补成 false，所以输入侧允许省略。
 */
export type VisibleModelInput = { id: string; name?: string; supportsTransparent?: boolean }

/**
 * 清洗覆盖价行：trim 模型 id、价格保留两位小数。
 *
 * 空 id、重复 id、价格非正数的行直接丢弃，而不是钳成默认价——与后端
 * normalizeImageModelCreditCosts 的语义一致，避免一次手滑输入静默改动某个模型的
 * 真实计费。
 */
export function normalizeModelPriceRows(rows: readonly ModelPriceRow[]): AdminImageModelCreditCost[] {
  const seen = new Set<string>()
  const result: AdminImageModelCreditCost[] = []
  for (const row of rows) {
    const id = row.id.trim()
    if (!id || seen.has(id)) continue
    // normalizeCreditBalance 自己就会把金额舍到两位小数，这里不必再算一次——
    // 多出来的那次舍入看着像是在保证精度，实际上永远不会改变结果。
    const cost = normalizeCreditBalance(row.cost)
    if (cost === null || cost < 0.01) continue
    seen.add(id)
    result.push({ id, cost })
  }
  return result
}

/**
 * 清洗可见模型行：丢掉空行并按 id 去重。
 *
 * supportsTransparent 要一并保留：它是模型的能力位，只在后端落库。载入时若丢掉、
 * 提交时又只给 id 和 name，管理员哪怕只改价格也会让后端把它规范化成 false，
 * 把透明背景能力悄悄关掉。
 */
export function normalizeVisibleModels(rows: readonly VisibleModelInput[] | undefined): VisibleModelRow[] {
  const result: VisibleModelRow[] = []
  const seen = new Set<string>()
  for (const row of rows || []) {
    const id = (row?.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      name: (row?.name || '').trim(),
      supportsTransparent: Boolean(row?.supportsTransparent),
    })
  }
  return result
}

/** 可见模型列表是否与载入时不同；相同就不该出现在 PATCH 里，避免覆盖他人更新。 */
export function visibleModelsDirty(
  current: readonly VisibleModelInput[] | undefined,
  loaded: readonly VisibleModelInput[] | undefined,
): boolean {
  return JSON.stringify(normalizeVisibleModels(current)) !== JSON.stringify(normalizeVisibleModels(loaded))
}

/** 某模型的生效单价：命中覆盖价用覆盖价，否则回退兜底价。 */
export function effectiveModelPrice(
  cost: number | null | undefined,
  fallback: number,
): number {
  const value = normalizeCreditBalance(cost ?? 0)
  return value !== null && value >= 0.01 ? value : fallback
}

/** 把候选里尚未出现的项补进列表；用于「带入已启用模型」等一键填充。 */
export function fillRows<T extends { id: string }>(
  rows: T[],
  candidateIds: readonly string[],
  create: (id: string) => T,
): void {
  const existing = new Set(rows.map(row => row.id.trim()).filter(Boolean))
  for (const id of candidateIds) {
    if (existing.has(id)) continue
    rows.push(create(id))
    existing.add(id)
  }
}
