import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../src/i18n'
import { localizedClientErrorMessage } from '../src/utils/client-error-message'

const FALLBACK = 'account.keys.listFailed'

/**
 * `localizedClientErrorMessage` 是 safe-error 的本地化门面。它必须满足两点,
 * 否则调用方(账号弹窗 / 用户密钥面板)会丢文案:
 * 1. 分类命中时用 i18n 文案,而不是 safe-error 里写死的中文;
 * 2. 无法分类时保留调用方抛出的原始信息——包括调用方自己已经本地化过的
 *    文案,例如 UserApiKeys 抛出的 t(feedback.loginRequired)。
 */
describe('localizedClientErrorMessage', () => {
  afterEach(() => {
    i18n.global.locale.value = 'zh'
  })

  it('maps the timeout / network / upstream categories to localized copy', () => {
    expect(localizedClientErrorMessage(new Error('AbortError: timeout'), FALLBACK))
      .toBe(i18n.global.t('feedback.timeout'))
    expect(localizedClientErrorMessage(new Error('Failed to fetch'), FALLBACK))
      .toBe(i18n.global.t('feedback.network'))
    expect(localizedClientErrorMessage(new Error('502 Bad Gateway'), FALLBACK))
      .toBe(i18n.global.t('feedback.upstream'))
  })

  it('localizes the category branches in the active locale', () => {
    i18n.global.locale.value = 'en'
    expect(localizedClientErrorMessage(new Error('AbortError: timeout'), FALLBACK)).toBe('The service timed out, please try again.')
  })

  it('keeps an already-localized message instead of replacing it with the fallback', () => {
    const localized = i18n.global.t('feedback.loginRequired')
    expect(localized).not.toBe(i18n.global.t(FALLBACK))
    expect(localizedClientErrorMessage(new Error(localized), FALLBACK)).toBe(localized)
  })

  it('keeps an unclassified upstream error message', () => {
    expect(localizedClientErrorMessage(new Error('额度不足'), FALLBACK)).toBe('额度不足')
  })

  it('falls back when the message is empty or carries redacted material', () => {
    const fallback = i18n.global.t(FALLBACK)
    expect(localizedClientErrorMessage(new Error(''), FALLBACK)).toBe(fallback)
    expect(localizedClientErrorMessage(new Error('https://api.example.com/v1/keys failed'), FALLBACK)).toBe(fallback)
  })
})
