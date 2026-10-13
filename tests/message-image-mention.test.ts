import { describe, expect, it } from 'vitest'
import {
  renderImageMentions,
  renderImageMentionsAsText,
  shiftImageMentionsAfterRemoval,
  stripImageMentions,
} from '../src/lib/message-image-mention'

/**
 * 对话正文里的图片引用标记。
 *
 * 标记是 `{{image:N}}`，N 是这条消息附图数组的下标（从 1 开始）。三个消费方
 * 各有各的渲染方式，这里分别钉住：
 *   - 界面（用户看的）    → 跟随语言，如「图1」/「Image 1」
 *   - 发给模型（模型看的）→ 固定文本，不随语言变
 *   - 标题等不吃标记的地方 → 直接去掉
 */

const zhLabel = (index: number) => `图${index}`
const enLabel = (index: number) => `Image ${index}`

describe('renderImageMentions', () => {
  it('replaces a marker with the localized label', () => {
    expect(renderImageMentions('参考 {{image:1}} 的风格', 1, zhLabel)).toBe('参考 图1 的风格')
    expect(renderImageMentions('See {{image:1}}', 1, enLabel)).toBe('See Image 1')
  })

  it('renders each marker against its own index', () => {
    const out = renderImageMentions('{{image:1}} 和 {{image:2}} 对比', 2, zhLabel)
    expect(out).toBe('图1 和 图2 对比')
  })

  it('drops out-of-range markers instead of leaking the raw token', () => {
    // 附图被删掉、或消息来自别的客户端时 N 会越界。宁可少一个标记，
    // 也不要让用户看到 {{image:9}} 这种原始占位符。
    expect(renderImageMentions('参考 {{image:9}}', 1, zhLabel)).toBe('参考 ')
    expect(renderImageMentions('{{image:0}}', 1, zhLabel)).toBe('')
    expect(renderImageMentions('{{image:1}}', 0, zhLabel)).toBe('')
  })

  it('leaves ordinary text untouched', () => {
    expect(renderImageMentions('没有标记的正文', 3, zhLabel)).toBe('没有标记的正文')
    // 邮箱里的 @ 不该被当成引用（这是不同的机制，但容易被混淆）。
    expect(renderImageMentions('写信给 a@b.com', 1, zhLabel)).toBe('写信给 a@b.com')
  })

  it('handles adjacent markers and surrounding whitespace', () => {
    expect(renderImageMentions('{{image:1}}{{image:2}}', 2, zhLabel)).toBe('图1图2')
  })
})

describe('renderImageMentionsAsText', () => {
  it('produces a language-independent description for the model', () => {
    // 这段文本是发给模型的输入，不是界面文案——必须稳定，否则同一个会话在
    // 不同语言下会给模型不同的提示。
    expect(renderImageMentionsAsText('参考 {{image:1}}', 1)).toBe('参考 第 1 张图')
  })

  it('does not depend on any locale input', () => {
    const output = renderImageMentionsAsText('{{image:2}}', 2)
    expect(output).toBe('第 2 张图')
  })

  it('drops out-of-range markers', () => {
    expect(renderImageMentionsAsText('{{image:5}}', 2)).toBe('')
  })
})

describe('stripImageMentions', () => {
  it('removes markers but keeps the rest of the text', () => {
    expect(stripImageMentions('参考 {{image:1}} 的风格')).toBe('参考  的风格')
  })

  it('is safe on text without markers', () => {
    expect(stripImageMentions('普通正文')).toBe('普通正文')
  })
})

describe('shiftImageMentionsAfterRemoval', () => {
  it('shifts every later marker down by one', () => {
    // 删掉第 1 张（下标 0）后，原来的第 2、3 张变成第 1、2 张。
    expect(shiftImageMentionsAfterRemoval('{{image:2}} 和 {{image:3}}', 0))
      .toBe('{{image:1}} 和 {{image:2}}')
  })

  it('clears the marker that pointed at the removed image', () => {
    // 指向被删那张的标记失去目标，必须清掉——留着会安静地指到后面那张图上。
    expect(shiftImageMentionsAfterRemoval('看 {{image:2}}', 1)).toBe('看 ')
  })

  it('leaves earlier markers untouched', () => {
    expect(shiftImageMentionsAfterRemoval('{{image:1}} 和 {{image:3}}', 1))
      .toBe('{{image:1}} 和 {{image:2}}')
  })

  it('handles removing the last image', () => {
    expect(shiftImageMentionsAfterRemoval('{{image:1}} {{image:2}}', 1)).toBe('{{image:1}} ')
  })

  it('is a no-op when the marker points before the removal', () => {
    expect(shiftImageMentionsAfterRemoval('只看 {{image:1}}', 2)).toBe('只看 {{image:1}}')
  })

  it('is safe on text without markers', () => {
    expect(shiftImageMentionsAfterRemoval('普通正文', 0)).toBe('普通正文')
  })

  it('never leaves a marker pointing at a different image than before', () => {
    // 这个函数的全部意义：删除前后，每个标记指向的「那张图」必须不变或消失，
    // 绝不能变成另一张。逐条验证一遍。
    const content = '{{image:1}} {{image:2}} {{image:3}}'
    const afterRemoveFirst = shiftImageMentionsAfterRemoval(content, 0)
    // 原来指第 2 张的标记现在应指第 1 张（也就是原来的第 2 张）。
    expect(afterRemoveFirst).toBe(' {{image:1}} {{image:2}}')
  })
})
