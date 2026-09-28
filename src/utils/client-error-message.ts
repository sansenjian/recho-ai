import i18n from '../i18n'
import { classifyClientError, publicClientErrorMessage } from '../lib/safe-error'

/**
 * 本地化错误文案门面。safe-error 的 timeout/network/upstream 分支写死中文,
 * 直接用到面向用户的界面会在英文语言下漏出中文;这里把分类结果映射到 i18n,
 * 只有无法分类时才回落到(已脱敏的)原始信息或调用方提供的兜底键。
 */
export function localizedClientErrorMessage(error: unknown, fallbackKey: string) {
  const category = classifyClientError(error)
  if (category === 'timeout') return i18n.global.t('feedback.timeout')
  if (category === 'network') return i18n.global.t('feedback.network')
  if (category === 'upstream') return i18n.global.t('feedback.upstream')
  return publicClientErrorMessage(error, i18n.global.t(fallbackKey))
}
