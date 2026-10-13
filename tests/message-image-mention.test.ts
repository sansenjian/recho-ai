import { describe, expect, it } from 'vitest'
import {
  renderImageMentions,
  renderImageMentionsAsText,
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
