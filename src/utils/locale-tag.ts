import i18n from '../i18n'

/** 跟随当前语言的日期/数字格式标签；写死 zh-CN 会让英文界面仍按中文顺序渲染日期。 */
export function localeTag() {
  return i18n.global.locale.value === 'zh' ? 'zh-CN' : 'en-US'
}
