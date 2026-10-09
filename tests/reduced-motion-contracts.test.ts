// 这里断言的是源码文本契约:AppShell 没有渲染测试(要拉起 router/store/i18n),
// 而这两个行为在浏览器里分别表现为「开了减少动效仍然平滑滚动」和
// 「键盘高亮和 hover 糊在一起」,单元测试量不到,只能在文本层锁死。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const componentPath = resolve(__dirname, '../src/components/ImageModelSelect.vue')
const shellPath = resolve(__dirname, '../src/views/AppShell.vue')

const component = readFileSync(componentPath, 'utf8')
const shell = readFileSync(shellPath, 'utf8')

describe('reduced motion is honoured by programmatic scrolling', () => {
  it('imports and instantiates the shared reduced-motion composable', () => {
    expect(shell).toContain("import { useReducedMotion } from '../composables/useReducedMotion'")
    expect(shell).toContain('const prefersReducedMotion = useReducedMotion()')
  })

  it('drops smooth scrolling in scrollToBottom when the user asked for less motion', () => {
    // 断言行为而不是字面量：smooth/auto 的落地实现已抽到 utils/scroll-settle 的
    // scrollElementTo，这里只要确认 scrollToBottom 把它建立在动效偏好之上。
    const block = shell.match(/function scrollToBottom\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''

    expect(block).toContain('prefersReducedMotion.value')
    expect(block).toMatch(/scrollElementTo\(/) 
  })

  it('resolves smooth vs auto inside the shared scroll helper', () => {
    // 抽出去的那一层要真的做降级，否则上面那条断言就只是形式上的。
    const helper = readFileSync(resolve(__dirname, '../src/utils/scroll-settle.ts'), 'utf8')
    expect(helper).toContain("smooth ? 'smooth' : 'auto'")
  })

  it('keeps the jumpToMessage fallback it was aligned with', () => {
    expect(shell).toContain('behavior: prefersReducedMotion.value ? ' + "'auto' : 'smooth'")
  })
})

describe('the active option carries its own marker', () => {
  it('moves data-active out of the hover/selected rule', () => {
    const rule = component.match(/\.image-model-option:hover,[\s\S]*?\n\}/)?.[0] ?? ''

    expect(rule).toContain(".image-model-option[aria-selected='true']")
    expect(rule).not.toContain("data-active")
  })

  it('gives the active option an inset ring instead of only a background', () => {
    const rule =
      component.match(/\.image-model-option\[data-active='true'\] \{[\s\S]*?\n\}/)?.[0] ?? ''

    expect(rule).toContain('box-shadow: inset')
    expect(rule).toContain('hsl(var(--ring) / 0.45)')
    // inset 不占布局框,行高仍是 .image-model-option 的 min-height: 40px。
    expect(rule).not.toContain('border:')
  })
})
