import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

/**
 * 每条 i18n 消息都必须能编译。
 *
 * vue-i18n 的消息不是普通字符串，是一套小语言：裸 `@` 是 linked-message
 * 起始符（`@:key` / `@.modifier`），单引号是转义边界，`{name}` 是具名插值。
 * 写错的时候「键存在」——所以 admin-i18n-parity 这类只查键的测试查不出来——
 * 但渲染那一刻会抛：
 *
 *   SyntaxError: Message compilation error: Invalid linked format
 *
 * 而 Vue 的渲染是整体失败的：一个叶子节点抛错，整块面板都渲染不出来，DOM 停在
 * 上一次的状态。表现出来往往是「一直显示加载中」，非常难往文案上联想。
 *
 * 这个坑项目里踩过两次：`you@example.com` 的占位符（见
 * account-panel-credentials.test.ts），以及图片分析面板的「平均 @ 提及」。
 * 两次都是靠人工二分才定位到，所以这里直接把整个 messages 树遍历编译一遍，
 * 让下一个人在 CI 就拿到行号和键名，而不是去 debug 一个空面板。
 */

/** 递归收集叶子消息，带上完整的点分路径以便报错时直接定位。 */
function collectMessages(node: unknown, prefix = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]]
  if (!node || typeof node !== 'object') return []

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    collectMessages(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('i18n messages compile', () => {
  for (const [locale, messages] of [['zh', zh], ['en', en]] as const) {
    it(`compiles every ${locale} message`, () => {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { [locale]: messages } })
      const failures: string[] = []

      for (const [key, value] of collectMessages(messages)) {
        try {
          // 传一组具名参数：既触发编译，又不会因为缺少插值变量而报别的错。
          i18n.global.t(key, { name: 'x', average: '0', p50: '0', p90: '0', count: 0, total: 0 })
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          failures.push(`${locale}.${key} = ${JSON.stringify(value)}\n      → ${detail}`)
        }
      }

      expect(failures, `以下消息无法编译（多为裸 @ 或未转义的单引号）：\n    ${failures.join('\n    ')}`).toEqual([])
    })
  }

  it('catches the bare-at-sign case this guard exists for', () => {
    // 反向验证：如果这段守卫失效（比如 createI18n 换成不做编译的实现），
    // 这条用例会失败，提醒守卫本身需要修，而不是静静放行。
    const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh: { bad: '平均 @ 提及' } } })

    expect(() => i18n.global.t('bad')).toThrow(/Invalid linked format/)
  })

  it('renders an escaped at-sign literally', () => {
    // 正确写法是 vue-i18n 的字面量转义。项目里邮箱占位符就是这么写的。
    const i18n = createI18n({
      legacy: false,
      locale: 'zh',
      messages: { zh: { good: "you{'@'}example.com" } },
    })

    expect(i18n.global.t('good')).toBe('you@example.com')
  })
})
