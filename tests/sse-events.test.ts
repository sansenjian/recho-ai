import { describe, expect, it } from 'vitest'
import { createSSEEventParser } from '../src/utils/sse-events'
import type { ChatEvent } from '../src/types/tools'

function collectEvents(chunks: string[]): ChatEvent[] {
  const events: ChatEvent[] = []
  const parser = createSSEEventParser(event => events.push(event))
  for (const chunk of chunks) parser.pushText(chunk)
  return events
}

describe('SSE event parser', () => {
  it('parses gateway-normalized delta events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ type: 'delta', content: 'hello' })}\n\n`,
    ])

    expect(events).toEqual([{ type: 'delta', content: 'hello' }])
  })

  it('parses OpenAI-compatible raw chunks', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hel' } }] })}\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n`,
    ])

    expect(events).toEqual([
      { type: 'delta', content: 'hel' },
      { type: 'delta', content: 'lo' },
    ])
  })

  it('keeps OpenAI-compatible reasoning content as thinking events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先分析问题' } }] })}\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '最终回答' } }] })}\n`,
    ])

    expect(events).toEqual([
      { type: 'thinking_delta', content: '先分析问题' },
      { type: 'delta', content: '最终回答' },
    ])
  })

  it('keeps alternative provider reasoning fields as thinking events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: '内部推理', thinking: '备用思考', content: '最终回答' } }] })}\n`,
    ])

    expect(events).toEqual([
      { type: 'thinking_delta', content: '内部推理' },
      { type: 'thinking_delta', content: '备用思考' },
      { type: 'delta', content: '最终回答' },
    ])
  })

  it('parses gateway-normalized thinking events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ type: 'thinking_delta', content: '正在分析' })}\n`,
    ])

    expect(events).toEqual([
      { type: 'thinking_delta', content: '正在分析' },
    ])
  })

  it('forwards tool lifecycle events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ type: 'tool_call', id: '1', name: 'search', arguments: { q: 'vue' }, status: 'running' })}\n`,
      `data: ${JSON.stringify({ type: 'tool_result', id: '1', name: 'search', result: 'ok', isError: false })}\n`,
      `data: ${JSON.stringify({ type: 'tool_end', id: '1', status: 'done' })}\n`,
    ])

    expect(events).toEqual([
      { type: 'tool_call', id: '1', name: 'search', arguments: { q: 'vue' }, status: 'running' },
      { type: 'tool_result', id: '1', name: 'search', result: 'ok', isError: false },
      { type: 'tool_end', id: '1', status: 'done' },
    ])
  })

  it('parses structured run lifecycle events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ type: 'status', state: 'thinking', label: '思考中' })}\n`,
      `data: ${JSON.stringify({ type: 'content_start', blockType: 'text', blockId: 'text-1' })}\n`,
      `data: ${JSON.stringify({ type: 'content_delta', blockId: 'text-1', text: 'hello' })}\n`,
      `data: ${JSON.stringify({ type: 'message_complete', finishReason: 'stop', incomplete: false })}\n`,
    ])

    expect(events).toEqual([
      { type: 'status', state: 'thinking', label: '思考中' },
      { type: 'content_start', blockType: 'text', blockId: 'text-1' },
      { type: 'content_delta', blockId: 'text-1', text: 'hello' },
      { type: 'message_complete', finishReason: 'stop', incomplete: false },
    ])
  })

  it('splits thinking tags across chunks into thinking events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ type: 'delta', content: 'visible <thinking>hidden' })}\n`,
      `data: ${JSON.stringify({ type: 'delta', content: '</thinking> done' })}\n`,
    ])

    expect(events).toEqual([
      { type: 'delta', content: 'visible ' },
      { type: 'thinking_delta', content: 'hidden' },
      { type: 'delta', content: ' done' },
    ])
  })

  it('splits short think tags too', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ type: 'delta', content: '<think>plan</think>answer' })}\n`,
    ])

    expect(events).toEqual([
      { type: 'thinking_delta', content: 'plan' },
      { type: 'delta', content: 'answer' },
    ])
  })

  it('handles done and error events', () => {
    const events = collectEvents([
      `data: ${JSON.stringify({ error: 'bad stream' })}\n`,
      'data: [DONE]\n',
    ])

    expect(events).toEqual([
      { type: 'error', error: 'bad stream' },
      { type: 'done' },
    ])
  })
})
