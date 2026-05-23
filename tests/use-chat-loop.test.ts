import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { ChatMessage } from '../src/types/events'
import { activeConversationId, conversations } from '../src/stores/chat'

const streamChatMock = vi.hoisted(() => vi.fn(async (...args: unknown[]) => { void args }))

vi.mock('../src/composables/useStream', () => ({
  useStream: () => ({ streamChat: streamChatMock }),
}))

import { useChatLoop } from '../src/composables/useChatLoop'

beforeEach(async () => {
  streamChatMock.mockClear()
  localStorage.clear()
  conversations.value = [
    {
      id: 1,
      title: 'New Chat',
      messages: [],
      systemPrompt: '',
      groupId: null,
      createdAt: 'now',
      updatedAt: 'now',
    },
  ]
  activeConversationId.value = 1
  await nextTick()
})

describe('useChatLoop', () => {
  it('sends the submitted user message only once', async () => {
    const { submitMessage } = useChatLoop()

    await submitMessage('hello', 'test-model')

    const messages = streamChatMock.mock.calls[0]?.[0] as unknown as ChatMessage[]
    expect(messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'hello' })
  })

  it('converts user images into vision content without duplicating the message', async () => {
    const { submitMessage } = useChatLoop()
    const image = 'data:image/jpeg;base64,abc'

    await submitMessage('look', 'test-model', [image])

    const messages = streamChatMock.mock.calls[0]?.[0] as unknown as ChatMessage[]
    const userMessages = messages.filter(m => m.role === 'user')

    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: image } },
    ])
  })

  it('stores tool calls on the assistant message timeline before rendered content', async () => {
    streamChatMock.mockImplementationOnce(async (_messages, callbacks: any) => {
      callbacks.onToolCall('tool-1', 'tavily_search', { query: '杭州天气' })
      callbacks.onToolResult('tool-1', 'tavily_search', 'search result', false)
      callbacks.onToolEnd('tool-1', 'done')
      callbacks.onDelta('根据搜索结果整理如下')
      callbacks.onMessageComplete?.({ finishReason: 'stop', incomplete: false })
    })
    const { submitMessage } = useChatLoop()

    await submitMessage('杭州天气', 'test-model')

    const assistant = conversations.value[0].messages.find(m => m.role === 'assistant')
    expect(assistant?.blocks).toEqual([
      {
        id: 'tool-1',
        type: 'tool_use',
        toolUseId: 'tool-1',
        name: 'tavily_search',
        input: { query: '杭州天气' },
        result: 'search result',
        isError: false,
        status: 'done',
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
      },
      {
        id: expect.any(String),
        type: 'assistant_text',
        content: '根据搜索结果整理如下',
        status: 'complete',
      },
    ])
    expect(assistant?.toolCalls).toHaveLength(1)
    expect(assistant?.toolCalls?.[0]).toMatchObject({
      id: 'tool-1',
      name: 'tavily_search',
      arguments: { query: '杭州天气' },
      result: 'search result',
      status: 'done',
    })
    expect(assistant?.content).toBe('根据搜索结果整理如下')
  })

  it('stores visible thinking on the assistant message without mixing it into content', async () => {
    streamChatMock.mockImplementationOnce(async (_messages, callbacks: any) => {
      callbacks.onThinkingDelta('先判断是否需要搜索')
      callbacks.onDelta('需要搜索最新天气。')
      callbacks.onMessageComplete?.({ finishReason: 'stop', incomplete: false })
    })
    const { submitMessage } = useChatLoop()

    await submitMessage('杭州天气', 'test-model')

    const assistant = conversations.value[0].messages.find(m => m.role === 'assistant')
    expect(assistant?.blocks).toEqual([
      {
        id: expect.any(String),
        type: 'thinking',
        content: '先判断是否需要搜索',
        status: 'done',
      },
      {
        id: expect.any(String),
        type: 'assistant_text',
        content: '需要搜索最新天气。',
        status: 'complete',
      },
    ])
    expect(assistant?.thinking).toBe('先判断是否需要搜索')
    expect(assistant?.content).toBe('需要搜索最新天气。')
  })

  it('marks unfinished blocks as cancelled when generation is stopped', async () => {
    streamChatMock.mockImplementationOnce(async (_messages, callbacks: any) => {
      callbacks.onThinkingDelta('正在分析')
      callbacks.onToolCall('tool-1', 'tavily_search', { query: '杭州天气' })
      throw new DOMException('aborted', 'AbortError')
    })
    const { submitMessage } = useChatLoop()

    await submitMessage('杭州天气', 'test-model')

    const assistant = conversations.value[0].messages.find(m => m.role === 'assistant')
    expect(assistant?.blocks).toEqual([
      {
        id: expect.any(String),
        type: 'thinking',
        content: '正在分析',
        status: 'cancelled',
      },
      {
        id: 'tool-1',
        type: 'tool_use',
        toolUseId: 'tool-1',
        name: 'tavily_search',
        input: { query: '杭州天气' },
        status: 'cancelled',
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
      },
      {
        id: expect.any(String),
        type: 'assistant_text',
        content: '[已停止]',
        status: 'incomplete',
      },
    ])
  })

  it('adds a general clarification policy before tool use', async () => {
    const { submitMessage } = useChatLoop()

    await submitMessage('今天天气怎么样', 'test-model')

    expect(streamChatMock).toHaveBeenCalledOnce()
    const messages = streamChatMock.mock.calls[0]?.[0] as unknown as ChatMessage[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('缺失的关键信息')
    expect(messages[0].content).toContain('查天气但没有城市或地区')
    expect(messages[0].content).toContain('一次最多问 1-2 个最关键问题')
    expect(messages[0].content).toContain('短词或短句')
    expect(messages[0].content).toContain('不要输出内部思考')
  })

  it('does not persist leaked analysis fragments from streamed deltas', async () => {
    streamChatMock.mockImplementationOnce(async (_messages, callbacks: any) => {
      callbacks.onDelta("我有线 understanding the user's query),\n")
      callbacks.onDelta('["budget", "preferences.", "headphones高尔夫球"]\n')
      callbacks.onDelta('}请问您的预算GG // Es konnte sein, dass der Benutzer | Final Extract after | Grundlegend思考：User möchte wissen\n')
      callbacks.onDelta('不过您的问题不太完整，希望我能帮助您！')
    })
    const { submitMessage } = useChatLoop()

    await submitMessage('听歌', 'test-model')

    const assistant = conversations.value[0].messages.find(m => m.role === 'assistant')
    expect(assistant?.content).not.toContain("understanding the user's query")
    expect(assistant?.content).not.toContain('Final Extract')
    expect(assistant?.content).toContain('请问您的预算')
  })
})
