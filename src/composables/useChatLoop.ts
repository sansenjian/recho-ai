import { ref } from 'vue'
import type { AgentModeOption, Message, MessageBlock } from '../types'
import { DEFAULT_SYSTEM_PROMPT } from '../types'
import type { VisionContent } from '../types/events'
import type { RunState, ToolStatus } from '../types/tools'
import {
  activeConversationId,
  getActiveConversation,
  updateConversationTitle,
  setConversationTitle,
  touchConversation,
} from '../stores/chat'
import { useStream } from './useStream'
import { useTools } from './useTools'
import { getRendered, sanitizeVisibleAssistantText } from '../utils/markdown'

const CLOUD_PLATFORM_BOUNDARY = `云平台安全边界：
- 平台运行在云端。不要声称可以操控用户本地电脑，也不要声称可以直接编辑服务器项目文件。
- 除已配置的后端 API/MCP 工具外，只能提供分析、计划、代码片段、补丁建议和可由平台安全执行的工具调用结果。
- 不要要求用户授予本地文件、终端、浏览器或服务器权限；当前产品没有面向普通用户的 Permissions 授权流程。
- 如果用户请求超出云端能力边界，直接说明边界，并给出平台内可完成的替代方案。`
const TOOL_USE_CLARIFICATION_POLICY = `对话和工具协议：

1. 行动优先
- 能直接回答就直接回答；能用合理默认假设推进就继续推进，并在答案里简短说明假设。
- 不要把轻微缺失的信息变成阻塞问题。只有缺失的关键信息会让结果完全不可用、可能误导用户，或涉及安全/隐私/金钱风险时，才追问。
- 追问时一次最多问 1 个最关键问题；不要一次列出很多问题让用户填表。
- 已经从用户回复中拿到的信息，不要重复确认，也不要换一种说法再问一遍。

2. 追问闸门
- 必须追问的典型情况：查天气但没有城市或地区；查路线/票价/价格但缺少对象、地点或日期；处理代码/项目任务但缺少目标文件、报错或期望结果；执行可能造成损失的操作但缺少确认。
- 如果用户在你追问后只回复一个短词或短句（例如“听歌”“500以内”“安卓”“游戏”），把它理解为对上一轮追问的补充，并结合上一轮目标继续推进。
- 对同一个目标最多追问 1 轮。追问 1 轮后，只要用户补充了任何有效条件，就禁止再次追问，必须给出 best-effort 答案。

3. 推荐、购买、对比类任务
- 这类任务默认直接给出建议，不要先把用户带入问卷。
- 如果用户只说“我想买耳机/电脑/手机/相机/键盘”等泛需求，直接按低/中/高预算或入门/均衡/高端分层推荐，并说明适用人群。
- 如果用户补充了用途、预算、设备、品牌、场景中的任意 1 个条件，就直接收敛到 2-4 个选项；不要继续追问预算、颜色、品牌偏好等非阻断信息。
- 预算未知时，不要问“预算多少”；改为按价位分层推荐。缺少品牌、颜色、外观偏好时，默认中性偏好。
- 对有时效性的推荐、价格、库存、榜单和新品，优先搜索；搜索不可用时，说明可能不是最新价格，并给出选购标准。

4. 工具使用
- 需要最新信息、事实核查、网页资料、价格、新闻、政策、版本、赛事或公开资料时，主动使用搜索工具。
- 不要为了表现工具能力而调用工具。用户只是要常识解释、写作、学习辅导或已有上下文足够时，直接回答。
- 工具结果只作为依据进入回答；不要把工具原始 JSON、日志、内部字段名或调试文本展示给用户。

5. 输出规范
- 使用用户正在使用的语言。不要混用无关语言。
- 最终回答只输出给用户看的内容；不要输出内部思考、analysis、草稿、提取字段、JSON/数组片段、日志或调试文本。
- 回答要先给结论，再给必要依据和下一步。避免“首先/让我来/好的，我来/我将会”等过程性开场。`

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'AbortError')
}

export function useChatLoop() {
  const isLoading = ref(false)
  const abortController = ref<AbortController | null>(null)
  const runState = ref<RunState>('idle')
  const runStatusLabel = ref('')

  const { streamChat } = useStream()
  const { activeToolCalls, completedToolCalls, onToolCall, onToolResult, onToolEnd, resetTools, snapshotTools } = useTools()

  function getActiveOrThrow() {
    const convId = activeConversationId.value
    if (!convId) throw new Error('no active conversation')
    const conv = getActiveConversation()
    if (!conv) throw new Error('conversation not found')
    return { convId, conv }
  }

  function createAssistantMsg(): Message {
    return {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      blocks: [],
      timestamp: new Date().toISOString(),
    }
  }

  function nextBlockId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function ensureBlocks(message: Message): MessageBlock[] {
    if (!message.blocks) message.blocks = []
    return message.blocks
  }

  function findLastTextBlock(message: Message) {
    const blocks = ensureBlocks(message)
    const last = blocks[blocks.length - 1]
    return last?.type === 'assistant_text' ? last : null
  }

  function appendAssistantTextBlock(message: Message, content: string, status: 'streaming' | 'complete' | 'incomplete' = 'streaming') {
    const sanitized = sanitizeVisibleAssistantText(content)
    if (!sanitized) return
    const existing = findLastTextBlock(message)
    if (existing && existing.status === 'streaming') {
      existing.content = sanitizeVisibleAssistantText(`${existing.content}${sanitized}`)
      existing.status = status
      return
    }
    ensureBlocks(message).push({
      id: nextBlockId('text'),
      type: 'assistant_text',
      content: sanitized,
      status,
    })
  }

  function appendThinkingBlock(message: Message, content: string) {
    const blocks = ensureBlocks(message)
    const last = blocks[blocks.length - 1]
    if (last?.type === 'thinking' && last.status === 'running') {
      last.content += content
      return
    }
    blocks.push({
      id: nextBlockId('thinking'),
      type: 'thinking',
      content,
      status: 'running',
    })
  }

  function ensureRunningThinkingBlock(message: Message) {
    const running = ensureBlocks(message).some(block => block.type === 'thinking' && block.status === 'running')
    if (!running) appendThinkingBlock(message, '')
  }

  function upsertToolBlock(message: Message, id: string, name: string, input: Record<string, unknown>) {
    const blocks = ensureBlocks(message)
    const existing = blocks.find(block => block.type === 'tool_use' && block.toolUseId === id)
    if (existing?.type === 'tool_use') {
      existing.name = name
      existing.input = input
      if (existing.status !== 'cancelled') existing.status = 'running'
      return existing
    }
    const block: MessageBlock = {
      id,
      type: 'tool_use',
      toolUseId: id,
      name,
      input,
      status: 'running',
      startedAt: Date.now(),
    }
    blocks.push(block)
    return block
  }

  function completeToolBlock(message: Message, id: string, result: string, isError = false) {
    const block = ensureBlocks(message).find(item => item.type === 'tool_use' && item.toolUseId === id)
    if (block?.type !== 'tool_use') return
    block.result = result
    block.isError = isError
    block.status = isError ? 'error' : 'done'
    block.completedAt = Date.now()
  }

  function endToolBlock(message: Message, id: string | undefined, status: ToolStatus = 'done') {
    const blocks = ensureBlocks(message).filter((item): item is Extract<MessageBlock, { type: 'tool_use' }> => item.type === 'tool_use')
    const targets = id ? blocks.filter(block => block.toolUseId === id) : blocks.filter(block => block.status === 'running')
    for (const block of targets) {
      block.status = block.status === 'error' && status === 'done' ? 'error' : status
      if (block.status === 'error' || block.status === 'timeout') block.isError = true
      block.completedAt = block.completedAt || Date.now()
    }
  }

  function completeOpenBlocks(message: Message, incomplete = false) {
    for (const block of ensureBlocks(message)) {
      if (block.type === 'assistant_text' && block.status === 'streaming') {
        block.status = incomplete ? 'incomplete' : 'complete'
      }
      if (block.type === 'thinking' && block.status === 'running') {
        block.status = 'done'
      }
    }
  }

  function cancelOpenBlocks(message: Message) {
    let hasIncompleteText = false
    for (const block of ensureBlocks(message)) {
      if (block.type === 'assistant_text' && block.status === 'streaming') {
        block.status = 'incomplete'
        hasIncompleteText = true
      }
      if (block.type === 'assistant_text' && block.status === 'incomplete') {
        hasIncompleteText = true
      }
      if (block.type === 'thinking' && block.status === 'running') block.status = 'cancelled'
      if (block.type === 'tool_use' && block.status === 'running') {
        block.status = 'cancelled'
        block.completedAt = block.completedAt || Date.now()
      }
    }
    if (!hasIncompleteText) {
      appendAssistantTextBlock(message, '[已停止]', 'incomplete')
    }
  }

  function buildVisionContent(value: string, images?: string[]): string | VisionContent[] {
    if (!images || images.length === 0) return value
    const parts: VisionContent[] = []
    if (value) parts.push({ type: 'text', text: value })
    for (const url of images) parts.push({ type: 'image_url', image_url: { url } })
    return parts
  }

  async function submitMessage(
    value: string,
    model: string,
    images?: string[],
    skill?: string | null,
    agentMode?: AgentModeOption,
  ): Promise<void> {
    if (isLoading.value) return

    const { convId, conv } = getActiveOrThrow()
    const isFirstExchange = conv.messages.length === 0

    const userMsg: Message = {
      id: Date.now(),
      role: 'user',
      content: value,
      images,
      timestamp: new Date().toISOString(),
    }
    conv.messages.push(userMsg)
    touchConversation(convId)

    const assistantMsg = createAssistantMsg()
    conv.messages.push(assistantMsg)
    resetTools()

    isLoading.value = true
    runState.value = 'thinking'
    runStatusLabel.value = '准备生成回复'
    abortController.value = new AbortController()

    try {
      const systemPrompt = [
        conv.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        agentMode?.systemHint,
        TOOL_USE_CLARIFICATION_POLICY,
        CLOUD_PLATFORM_BOUNDARY,
      ].filter(Boolean).join('\n\n')

      await streamChat(
        [
          { role: 'system', content: systemPrompt },
          ...conv.messages.slice(0, -1).filter(m => m.content || m.images?.length).map(m => {
            if (m.role === 'user' && m.images?.length) {
              return { role: m.role, content: buildVisionContent(m.content, m.images) }
            }
            return { role: m.role, content: m.content }
          }),
        ],
        {
          onStatus: (state, label) => {
            runState.value = state
            runStatusLabel.value = label || ''
            if (state === 'thinking') ensureRunningThinkingBlock(assistantMsg)
          },
          onContentStart: (_blockType, _blockId) => {},
          onContentDelta: (_blockId, _text, _toolInput) => {},
          onThinkingDelta: (content) => {
            assistantMsg.thinking = `${assistantMsg.thinking ?? ''}${content}`
            appendThinkingBlock(assistantMsg, content)
          },
          onDelta: (content) => {
            assistantMsg.toolCalls = snapshotTools()
            assistantMsg.content += content
            assistantMsg.content = sanitizeVisibleAssistantText(assistantMsg.content)
            appendAssistantTextBlock(assistantMsg, content)
            getRendered(assistantMsg)
          },
          onToolCall: (id, name, args) => {
            onToolCall(id, name, args)
            upsertToolBlock(assistantMsg, id, name, args)
            assistantMsg.toolCalls = snapshotTools()
          },
          onToolResult: (id, name, result, isError) => {
            onToolResult(id, name, result, isError)
            completeToolBlock(assistantMsg, id, result, isError)
            assistantMsg.toolCalls = snapshotTools()
          },
          onToolEnd: (id, status) => {
            onToolEnd(id, status)
            endToolBlock(assistantMsg, id, status)
            assistantMsg.toolCalls = snapshotTools()
          },
          onMessageComplete: ({ incomplete }) => {
            completeOpenBlocks(assistantMsg, Boolean(incomplete))
          },
        },
        abortController.value.signal,
        skill,
        model,
      )
    } catch (err: unknown) {
      if (isAbortError(err)) {
        assistantMsg.content = [assistantMsg.content.trim(), '[已停止]'].filter(Boolean).join('\n\n')
        cancelOpenBlocks(assistantMsg)
      } else {
        const msg = err instanceof Error ? err.message : '未知错误'
        assistantMsg.content = `Error: ${msg}`
        appendAssistantTextBlock(assistantMsg, assistantMsg.content, 'incomplete')
      }
    } finally {
      completeOpenBlocks(assistantMsg)
      assistantMsg.toolCalls = snapshotTools()
      isLoading.value = false
      runState.value = 'idle'
      runStatusLabel.value = ''
      abortController.value = null
      touchConversation(convId)

      if (isFirstExchange && userMsg.content) {
        updateConversationTitle(convId, conv.messages)
        if (assistantMsg.content && !assistantMsg.content.startsWith('Error')) {
          autoGenerateTitle(convId, userMsg.content, assistantMsg.content, model)
        }
      }
    }
  }

  async function autoGenerateTitle(convId: number, userContent: string, assistantContent: string, model: string) {
    try {
      const summaryPrompt = `请基于以下对话内容，用5-10个字简洁总结对话主题。只输出主题文字，不要引号、标点或任何额外解释。

用户：${userContent.slice(0, 200)}
AI：${assistantContent.slice(0, 500)}`

      let title = ''
      await streamChat(
        [
          { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
          { role: 'user', content: summaryPrompt },
        ],
        { onDelta: (c) => { title += c }, onThinkingDelta: () => {}, onToolCall: () => {}, onToolResult: () => {}, onToolEnd: () => {} },
        undefined,
        null,
        model,
      )
      title = title.replace(/^["'「」『』【】《》\s]+|["'「」『』【】《》\s]+$/g, '').trim()
      if (title) {
        const final = title.length > 20 ? title.slice(0, 18) + '…' : title
        setConversationTitle(convId, final)
      }
    } catch { /* ignore */ }
  }

  function stopGeneration() {
    abortController.value?.abort()
  }

  return {
    isLoading,
    runState,
    runStatusLabel,
    activeToolCalls,
    completedToolCalls,
    submitMessage,
    stopGeneration,
  }
}
