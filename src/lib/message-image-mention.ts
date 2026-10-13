/**
 * 对话正文里的图片引用标记。
 *
 * 输入框的 @ 引用插入的是 `{{image:N}}`，N 是这条消息附图数组的下标（从 1 开始，
 * 与用户在菜单里看到的「图1」一致）。与画布的引用标记（`{{image:节点id}}`，见
 * image-mention-editor）是同一套写法，区别只在 N 的含义——画布指节点 id，这里
 * 指附图序号。
 *
 * 标记刻意与语言无关：它既作为消息正文发给模型，又要长期留在本地会话记录里。
 * 如果标记本身随界面语言变化，同一段对话在中文和英文下就是两种含义，切换语言
 * 还会让历史消息里的标记失去对应关系。所以标记只管结构化，显示文案交给渲染层。
 */

const IMAGE_MENTION_PATTERN = /\{\{image:(\d+)\}\}/g

/**
 * 把 `{{image:N}}` 换成给人看的标签。
 *
 * label 由调用方从 i18n 取（例如「图1」/「Image 1」），这样渲染出来的文字跟随
 * 界面语言，而存储的正文不变。
 *
 * 越界的 N（附图被删掉、或消息来自别的客户端）会被换成空串——宁可少一个标记，
 * 也不要让用户看到 `{{image:9}}` 这种原始占位符。
 */
export function renderImageMentions(
  content: string,
  imageCount: number,
  label: (index: number) => string,
) {
  if (!content.includes('{{image:')) return content

  return content.replace(IMAGE_MENTION_PATTERN, (_match, rawIndex: string) => {
    const index = Number(rawIndex)
    if (!Number.isInteger(index) || index < 1 || index > imageCount) return ''
    return label(index)
  })
}

/** 清掉标记但保留其余正文。给不吃标记的消费方（如标题生成）用。 */
export function stripImageMentions(content: string) {
  return content.replace(IMAGE_MENTION_PATTERN, '')
}

/**
 * 把标记换成模型能读懂的位置说明。
 *
 * 刻意不走 i18n：这段文本是**发给模型的输入**，不是界面文案。它必须稳定——
 * 跟随界面语言变化会让同一个会话在不同语言下给模型不同的提示（这个仓库里
 * AgentModeOption.systemHint 保持中文原文就是同一个理由，见 useChatLoop）。
 *
 * 用「第 N 张」而不是「图N」：模型对序数的理解比自定义标记可靠，而且这样和
 * 附图在数组里的顺序对应得上。
 */
export function renderImageMentionsAsText(content: string, imageCount: number) {
  if (!content.includes('{{image:')) return content

  return content.replace(IMAGE_MENTION_PATTERN, (_match, rawIndex: string) => {
    const index = Number(rawIndex)
    if (!Number.isInteger(index) || index < 1 || index > imageCount) return ''
    return `第 ${index} 张图`
  })
}

/**
 * 附图被移除后，修正正文里所有标记的序号。
 *
 * 标记的 N 是附图数组的下标，所以一旦从数组中间删掉一张，后面所有标记都会**整体
 * 前移一位**。这种错位比越界更危险：越界会被清掉，而错位不会——它只是安静地指向
 * 另一张图，模型收到错误的序号，界面显示错误的标签，全程没有任何提示。
 *
 * 所以删除时必须重写正文，而不是等渲染时补救（渲染时已经无从知道原来的对应关系）。
 *
 * @param removedIndex 被移除图片在**移除前**数组里的下标（从 0 开始）
 * @returns 重写后的正文
 */
export function shiftImageMentionsAfterRemoval(content: string, removedIndex: number) {
  if (!content.includes('{{image:')) return content

  const removed = removedIndex + 1

  return content.replace(IMAGE_MENTION_PATTERN, (match, rawIndex: string) => {
    const index = Number(rawIndex)
    if (!Number.isInteger(index)) return match
    // 指向被删掉那张图的标记失去目标，直接清掉——留着会指到后面那张图上。
    if (index === removed) return ''
    // 排在它后面的依次前移一位。
    if (index > removed) return `{{image:${index - 1}}}`
    return match
  })
}
