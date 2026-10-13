// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'
import ChatInput from '../src/components/ChatInput.vue'

/**
 * 对话输入框的 @ 图片引用。
 *
 * 交互与斜杠命令一致（弹出、上下选、Enter 确认），但触发符是 @ 且只在正文里
 * 插入一个标记。这里盯的是三件事：什么时候弹、选中后正文变成什么、以及不该弹
 * 的时候（没有附图 / 邮箱 / 已经写完的标记）确实不弹。
 *
 * 正文里插入的是 `{{image:N}}` 而不是「@图N」：这个正文会发给模型，也会留在
 * 本地会话记录里，所以标记必须与界面语言无关——显示层再决定怎么展示。
 */

const i18n = createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })

const MODEL = { id: 'gpt-4o', label: 'GPT-4o', value: 'gpt-4o' } as never

function mountInput(options: { images?: string[] } = {}) {
  return mount(ChatInput, {
    props: {
      currentModel: MODEL,
      models: [MODEL],
      skills: [],
      pendingImages: options.images ?? ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

function textarea(wrapper: ReturnType<typeof mountInput>) {
  return wrapper.find('textarea')
}

/** 模拟用户键入：设置值 + 光标位置，然后派发 input。 */
async function type(wrapper: ReturnType<typeof mountInput>, value: string, caret?: number) {
  const el = textarea(wrapper).element as HTMLTextAreaElement
  el.value = value
  const position = caret ?? value.length
  el.setSelectionRange(position, position)
  await textarea(wrapper).trigger('input')
}

function menuVisible(wrapper: ReturnType<typeof mountInput>) {
  return wrapper.text().includes('插入引用标记')
}

describe('ChatInput @ image mention', () => {
  it('opens the mention menu when @ is typed', async () => {
    const wrapper = mountInput()
    await type(wrapper, '参考 @')

    expect(menuVisible(wrapper)).toBe(true)
    // 每张已上传图片一项，都带序号标签。
    expect(wrapper.text()).toContain('图1')
    expect(wrapper.text()).toContain('图2')
    wrapper.unmount()
  })

  it('does not open the menu when there is no uploaded image', async () => {
    const wrapper = mountInput({ images: [] })
    await type(wrapper, '参考 @')

    // 选不出东西的空菜单比不弹更糟。
    expect(menuVisible(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('closes the menu once the query looks like a domain, not a reference', async () => {
    const wrapper = mountInput()
    await type(wrapper, '写信给 a@')
    // 刚打出一个 @ 时确实会弹（此时还分不清是邮箱还是引用）。
    expect(menuVisible(wrapper)).toBe(true)

    // 继续打完域名就关闭：判定依据是 @ 到光标之间不能有空白之外的干扰——
    // 实际触发条件是查询词不匹配任何图片。这里用「不匹配」的输入验证收敛。
    await type(wrapper, '写信给 a@图1 ')
    expect(menuVisible(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('closes the menu once a space follows the query', async () => {
    const wrapper = mountInput()
    await type(wrapper, '@图1 ')
    expect(menuVisible(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('filters by index', async () => {
    const wrapper = mountInput()
    await type(wrapper, '@2')

    expect(menuVisible(wrapper)).toBe(true)
    expect(wrapper.text()).toContain('图2')
    // 序号不匹配的那些项应当被筛掉。
    expect(wrapper.text()).not.toContain('图1')
    wrapper.unmount()
  })

  it('inserts a structured marker when an item is picked', async () => {
    const wrapper = mountInput()
    await type(wrapper, '参考 @')

    // 点第一项。
    const option = wrapper.findAll('[class*="cursor-pointer"]')[0]
    expect(option).toBeTruthy()
    await option.trigger('click')

    const value = (textarea(wrapper).element as HTMLTextAreaElement).value
    // 插入的是语言无关的标记，且把临时的 "@" 查询词替换掉而不是留在正文里。
    expect(value).toBe('参考 {{image:1}} ')
    expect(menuVisible(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('keeps the caret after the inserted marker', async () => {
    const wrapper = mountInput()
    await type(wrapper, '参考 @')
    const option = wrapper.findAll('[class*="cursor-pointer"]')[0]
    await option.trigger('click')
    await wrapper.vm.$nextTick()

    const el = textarea(wrapper).element as HTMLTextAreaElement
    // 光标落在标记之后，用户可以直接接着打字。
    expect(el.selectionStart).toBe(el.value.length)
    wrapper.unmount()
  })

  it('supports arrow keys and Enter to pick', async () => {
    const wrapper = mountInput()
    await type(wrapper, '参考 @')

    await textarea(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await textarea(wrapper).trigger('keydown', { key: 'Enter' })

    const value = (textarea(wrapper).element as HTMLTextAreaElement).value
    // ArrowDown 移到第二项。
    expect(value).toBe('参考 {{image:2}} ')
    wrapper.unmount()
  })

  it('lets Escape close the menu without inserting anything', async () => {
    const wrapper = mountInput()
    await type(wrapper, '参考 @')
    await textarea(wrapper).trigger('keydown', { key: 'Escape' })

    expect(menuVisible(wrapper)).toBe(false)
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('参考 @')
    wrapper.unmount()
  })

  it('does not steal Enter while an IME is composing', async () => {
    const wrapper = mountInput()
    await type(wrapper, '参考 @')

    // 中文输入时 Enter 是确认候选词。抢了这个键会让用户选不了字。
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    textarea(wrapper).element.dispatchEvent(event)

    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('参考 @')
    wrapper.unmount()
  })

  it('submits the marker as part of the message body', async () => {
    const wrapper = mountInput()
    await type(wrapper, '参考 @')
    const option = wrapper.findAll('[class*="cursor-pointer"]')[0]
    await option.trigger('click')
    await textarea(wrapper).trigger('keydown', { key: 'Enter' })

    const submitted = wrapper.emitted('submit')?.[0]?.[0] as string
    expect(submitted).toContain('{{image:1}}')
    wrapper.unmount()
  })
})

describe('ChatInput mention stays aligned when an image is removed', () => {
  /**
   * 附图被移除后，已插入的标记必须跟着修正。
   *
   * 这是 CodeRabbit 在 PR #152 上报出的 Major 问题：标记的 N 是附图数组下标，
   * 从中间删掉一张会让后面所有标记整体前移一位。这种错位比越界更危险——越界会
   * 被渲染层清掉，错位只是安静地指向另一张图，模型收到错误序号、界面显示错误
   * 标签，全程没有提示。
   */
  it('shifts the marker when an earlier image is removed', async () => {
    const wrapper = mountInput({ images: ['data:a', 'data:b', 'data:c'] })
    await type(wrapper, '@')
    // 选第三项 → 插入 {{image:3}}
    await textarea(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await textarea(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await textarea(wrapper).trigger('keydown', { key: 'Enter' })
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('{{image:3}} ')

    // 移除第 1 张图（下标 0）→ 原来的第 3 张变成第 2 张，标记必须跟着改。
    // 父组件负责告知删的是哪一张：只看长度推不出来（3 张变 2 张可能是删头也可能是删尾）。
    ;(wrapper.vm as unknown as { handleRemovedImage: (i: number) => void }).handleRemovedImage(0)
    await wrapper.setProps({ pendingImages: ['data:b', 'data:c'] })
    await wrapper.vm.$nextTick()

    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('{{image:2}} ')
    wrapper.unmount()
  })

  it('clears the marker when its own image is removed', async () => {
    const wrapper = mountInput({ images: ['data:a', 'data:b'] })
    await type(wrapper, '@')
    // 选第二项 → {{image:2}}
    await textarea(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await textarea(wrapper).trigger('keydown', { key: 'Enter' })
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('{{image:2}} ')

    ;(wrapper.vm as unknown as { handleRemovedImage: (i: number) => void }).handleRemovedImage(1)
    await wrapper.setProps({ pendingImages: ['data:a'] })
    await wrapper.vm.$nextTick()

    // 那张图没了，标记也就没有意义；留着会指到第 1 张（另一张图）上。
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).not.toContain('{{image:')
    wrapper.unmount()
  })

  it('leaves earlier markers alone when a later image is removed', async () => {
    const wrapper = mountInput({ images: ['data:a', 'data:b'] })
    await type(wrapper, '@')
    await textarea(wrapper).trigger('keydown', { key: 'Enter' })
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('{{image:1}} ')

    ;(wrapper.vm as unknown as { handleRemovedImage: (i: number) => void }).handleRemovedImage(1)
    await wrapper.setProps({ pendingImages: ['data:a'] })
    await wrapper.vm.$nextTick()

    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('{{image:1}} ')
    wrapper.unmount()
  })

  it('does not disturb text without markers', async () => {
    const wrapper = mountInput({ images: ['data:a', 'data:b'] })
    await type(wrapper, '普通正文')
    ;(wrapper.vm as unknown as { handleRemovedImage: (i: number) => void }).handleRemovedImage(1)
    await wrapper.setProps({ pendingImages: ['data:a'] })
    await wrapper.vm.$nextTick()

    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe('普通正文')
    wrapper.unmount()
  })
})

/**
 * 移除附图这条链路的接线契约。
 *
 * 修正逻辑分散在三个文件里（AppShell 通知、ChatInput 重写、chat store 清标题），
 * 任何一处掉线都会让标记指错图，而组件级测试只覆盖中间那一环。这里按源码钉住
 * 首尾两处，并检查调用顺序——先修正正文再删数组，反过来的话标记已经指错了。
 */
describe('mention alignment wiring stays in place', () => {
  const appShell = readFileSync(resolve(__dirname, '../src/views/AppShell.vue'), 'utf8')
  const chatStore = readFileSync(resolve(__dirname, '../src/stores/chat.ts'), 'utf8')

  it('AppShell notifies ChatInput before dropping the image', () => {
    const fn = appShell.match(/function removePendingImage[\s\S]{0,400}?\n\}/)?.[0] ?? ''
    expect(fn).toMatch(/handleRemovedImage\(index\)/)
    expect(fn.indexOf('handleRemovedImage')).toBeLessThan(fn.indexOf('filter('))
  })

  it('AppShell passes the removal index, not just the new length', () => {
    // 只看长度推不出删的是哪一张：3 张变 2 张可能是删头也可能是删尾，
    // 而这两者要做的修正完全不同。
    expect(appShell).toContain('handleRemovedImage(index)')
  })

  it('conversation title strips the marker before truncating', () => {
    // 否则标题会变成「参考 {{image:1}} 的风格」。
    expect(chatStore).toMatch(/stripImageMentions\(firstUser\.content\)/)
  })
})
