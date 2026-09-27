import { createI18n } from 'vue-i18n'
import en from './en'
import zh from './zh'

const isDev = import.meta.env.DEV

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'en',
  messages: { en, zh },
  // 开发期把缺键和回退暴露成控制台告警，避免漏翻的键静默渲染成英文或原始 key。
  missingWarn: isDev,
  fallbackWarn: isDev,
  warnHtmlMessage: isDev,
})

export default i18n
