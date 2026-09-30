import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const componentPath = resolve(__dirname, '../src/components/ImageModelSelect.vue')
const viewPath = resolve(__dirname, '../src/components/ImagioView.vue')

const component = readFileSync(componentPath, 'utf8')
const view = readFileSync(viewPath, 'utf8')

/**
 * 菜单的宽度出过两次回归:先是跟着被 flex-grow 撑开的 trigger 走,整行铺满;
 * 修好后又被 flex-basis 覆盖 width,把容器重新拉长。这里把「菜单宽度不依赖
 * trigger 宽度」这条契约钉在源码上——它在浏览器里只表现为「太长」,
 * 单测跑不出来,所以只能在文本层兜住。
 */
describe('ImageModelSelect menu width contract', () => {
  it('sizes the menu from its content instead of the trigger', () => {
    const menu = component.match(/\.image-model-menu \{[\s\S]*?\n\}/)?.[0] ?? ''

    expect(menu).toContain('width: max-content')
    // max(100%, …) 会让菜单至少和 trigger 一样宽,trigger 被撑开时菜单跟着变长。
    expect(menu).not.toMatch(/width:\s*min\(max\(100%/)
    expect(menu).toMatch(/max-width:\s*min\(300px/)
  })

  it('lets long model names truncate instead of widening the menu', () => {
    // flex 项默认 min-width:auto:少了这条,长名字会顶破 max-width 而不是省略号收尾。
    expect(component).toMatch(/\.image-model-option > span \{[\s\S]*?min-width: 0/)
  })

  it('does not let flex-basis override the picker width', () => {
    const picker = view.match(/\.prompt-model-select \{[\s\S]*?\n\}/)?.[0] ?? ''

    // flex-basis 在主轴优先于 width,flex-grow 又会吃掉整行剩余空间。
    expect(picker).toMatch(/flex:\s*0 1 auto/)
    expect(picker).not.toMatch(/flex:\s*1 1 80px/)
  })
})
