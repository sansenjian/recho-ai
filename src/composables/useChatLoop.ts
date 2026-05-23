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

const CLOUD_PLATFORM_BOUNDARY = '平台运行在云端。不要声称可以操控用户本地电脑，也不要声称可以直接编辑服务器项目文件。除已配置的后端 API/MCP 工具外，只能提供分析、计划、代码片段、补丁建议和可由平台安全执行的工具调用结果。'
const TOOL_USE_CLARIFICATION_POLICY = `工具使用原则：
- 当用户请求依赖缺失的关键信息时，先用自然语言追问用户，不要为了调用工具而调用工具。
- 追问时一次最多问 1-2 个最关键问题；不要一次列出很多问题让用户填表。
- 典型情况包括：查天气但没有城市或地区；查新闻但没有主题或时间范围；查价格/票价/路线但缺少对象、地点或日期；执行代码/项目任务但缺少目标文件、上下文或期望结果。
- 如果用户在你追问后只回复一个短词或短句（例如“听歌”“500以内”“安卓”），把它理解为对上一轮追问的补充，并结合上一轮用户目标继续推进；如果仍缺关键信息，只追问剩余最关键的信息。
- 只有在用户已经给出足够上下文，或可以从当前对话明确推断出必要参数时，才调用搜索、提取或其他工具。
- 最终回答只输出给用户看的内容；不要输出内部思考、analysis、草稿、提取字段、JSON/数组片段、日志、调试文本，也不要混用无关语言。`

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
    if (!content) return
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
