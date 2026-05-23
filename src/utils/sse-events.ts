import type { ChatEvent } from '../types/tools'

export function createSSEEventParser(onEvent: (event: ChatEvent) => void) {
  let thinkBuf = ''
  let inThink = false
  let lineBuf = ''

  function splitThinking(delta: string): Array<{ type: 'delta' | 'thinking_delta'; content: string }> {
    thinkBuf += delta
    const events: Array<{ type: 'delta' | 'thinking_delta'; content: string }> = []
    let i = 0

    while (i < thinkBuf.length) {
      if (inThink) {
        const lower = thinkBuf.toLowerCase()
        const thinkingEnd = lower.indexOf('</thinking>', i)
        const thinkEnd = lower.indexOf('</think>', i)
        const candidates = [thinkingEnd, thinkEnd].filter(index => index !== -1)
        const endTag = candidates.length > 0 ? Math.min(...candidates) : -1
        if (endTag === -1) {
          const content = thinkBuf.slice(i)
          if (content) events.push({ type: 'thinking_delta', content })
          thinkBuf = ''
          return events
        }
        const content = thinkBuf.slice(i, endTag)
        if (content) events.push({ type: 'thinking_delta', content })
        inThink = false
        i = endTag + (lower.startsWith('</thinking>', endTag) ? '</thinking>'.length : '</think>'.length)
      } else {
        const lower = thinkBuf.toLowerCase()
        const thinkingStart = lower.indexOf('<thinking>', i)
        const thinkStart = lower.indexOf('<think>', i)
        const candidates = [thinkingStart, thinkStart].filter(index => index !== -1)
        const startTag = candidates.length > 0 ? Math.min(...candidates) : -1
        if (startTag === -1) {
          const content = thinkBuf.slice(i)
          if (content) events.push({ type: 'delta', content })
          thinkBuf = ''
          return events
        }
        const content = thinkBuf.slice(i, startTag)
        if (content) events.push({ type: 'delta', content })
        i = startTag + (lower.startsWith('<thinking>', startTag) ? '<thinking>'.length : '<think>'.length)
        inThink = true
      }
    }

    thinkBuf = ''
    return events
  }

  function emitDelta(content: string) {
    for (const event of splitThinking(content)) {
      onEvent(event)
    }
  }

  function handleDataLine(data: string) {
    if (data.endsWith('\r')) data = data.slice(0, -1)
    if (data === '[DONE]') {
      onEvent({ type: 'done' })
      return
    }

    try {
      const parsed = JSON.parse(data)

      if (parsed.type === 'status') {
        onEvent({
          type: 'status',
          state: parsed.state || 'thinking',
          label: parsed.label,
        })
        return
      }
      if (parsed.type === 'content_start') {
        onEvent({
          type: 'content_start',
          blockType: parsed.blockType || 'text',
          blockId: parsed.blockId || '',
          toolName: parsed.toolName,
          toolUseId: parsed.toolUseId,
        })
        return
      }
      if (parsed.type === 'content_delta') {
        onEvent({
          type: 'content_delta',
          blockId: parsed.blockId || '',
          text: parsed.text,
          toolInput: parsed.toolInput,
        })
        return
      }
      if (parsed.type === 'message_complete') {
        onEvent({
          type: 'message_complete',
          finishReason: parsed.finishReason,
          incomplete: Boolean(parsed.incomplete),
        })
        return
      }
      if (parsed.type === 'tool_call') {
        onEvent({
          type: 'tool_call',
          id: parsed.id || '',
          name: parsed.name || '?',
          arguments: parsed.arguments || {},
          status: parsed.status,
        })
        return
      }
      if (parsed.type === 'tool_result') {
        onEvent({
          type: 'tool_result',
          id: parsed.id || '',
          name: parsed.name || '?',
          result: parsed.result || '',
          isError: Boolean(parsed.isError),
        })
        return
      }
      if (parsed.type === 'tool_end') {
        onEvent({ type: 'tool_end', id: parsed.id, status: parsed.status })
        return
      }
      if (parsed.type === 'thinking_delta' && typeof parsed.content === 'string') {
        onEvent({ type: 'thinking_delta', content: parsed.content })
        return
      }
      if (parsed.type === 'delta' && typeof parsed.content === 'string') {
        emitDelta(parsed.content)
        return
      }
      if (parsed.type === 'done') {
        onEvent({ type: 'done' })
        return
      }
      if (parsed.type === 'error' || typeof parsed.error === 'string') {
        onEvent({ type: 'error', error: parsed.error || 'stream error' })
        return
      }

      const delta = parsed.choices?.[0]?.delta
      if (!delta) return
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        onEvent({ type: 'thinking_delta', content: delta.reasoning_content })
      }
      if (typeof delta.reasoning === 'string' && delta.reasoning) {
        onEvent({ type: 'thinking_delta', content: delta.reasoning })
      }
      if (typeof delta.thinking === 'string' && delta.thinking) {
        onEvent({ type: 'thinking_delta', content: delta.thinking })
      }
      if (delta.content) emitDelta(delta.content)
    } catch { /* skip malformed */ }
  }

  function pushText(text: string) {
    const chunk = lineBuf + text
    const lines = chunk.split('\n')
    lineBuf = chunk.endsWith('\n') ? '' : lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      handleDataLine(line.slice(6))
    }
  }

  function reset() {
    thinkBuf = ''
    inThink = false
    lineBuf = ''
  }

  function flush() {
    pushText('')
    if (lineBuf.startsWith('data: ')) handleDataLine(lineBuf.slice(6))
    reset()
    onEvent({ type: 'done' })
  }

  return { pushText, flush, reset }
}
