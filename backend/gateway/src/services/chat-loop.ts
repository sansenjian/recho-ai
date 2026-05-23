import type { Response } from 'express'
import OpenAI from 'openai'
import { MAX_TOOL_ROUNDS, STREAM_START_TIMEOUT_MS, STREAM_TIMEOUT_MS } from '../config.js'
import { mcpManager } from '../mcp/manager.js'

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

interface ToolCallEvent {
  type: 'tool_call' | 'tool_result' | 'tool_end' | 'thinking_delta' | 'status' | 'content_start' | 'content_delta' | 'message_complete'
  id?: string
  name?: string
  arguments?: Record<string, unknown>
  content?: string
  result?: string
  isError?: boolean
  status?: string
  state?: string
  label?: string
  blockType?: string
  blockId?: string
  text?: string
  finishReason?: string | null
  incomplete?: boolean
}

// Kimi models emit proprietary tool-call markers in streamed text content.
// Strip them when the model doesn't use standard function-calling deltas.
const KIMI_TOOL_RE = /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g
const MAX_AUTO_CONTINUE_ROUNDS = 2
const CONTINUE_PROMPT = '请从上一条回答中断的位置继续，不要重复已经输出的内容。'

async function writeSSE(res: Response, payload: unknown): Promise<void> {
  if (res.writableEnded || res.destroyed) return
  const ok = res.write(`data: ${JSON.stringify(payload)}\n\n`)
  if (!ok) await waitForDrain(res)
}

export async function sendChatStatus(res: Response, state: string, label: string): Promise<void> {
  await writeSSE(res, { type: 'status', state, label } as ToolCallEvent)
}

async function writeRawSSE(res: Response, chunk: string): Promise<void> {
  if (res.writableEnded || res.destroyed) return
  const ok = res.write(chunk)
  if (!ok) await waitForDrain(res)
}

function waitForDrain(res: Response): Promise<void> {
  return new Promise(resolve => {
    const cleanup = () => {
      res.off('drain', done)
      res.off('close', done)
      res.off('error', done)
    }
    const done = () => {
      cleanup()
      resolve()
    }
    res.once('drain', done)
    res.once('close', done)
    res.once('error', done)
  })
}

async function finishStream(res: Response): Promise<void> {
  if (res.writableEnded) return
  await writeRawSSE(res, 'data: [DONE]\n\n')
  res.end()
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

export function looksAbrupt(content: string): boolean {
  const trimmed = content.trim()
  const lastLine = trimmed.split(/\r?\n/).filter(Boolean).at(-1)?.trim() || ''

  if ((trimmed.match(/\*\*/g)?.length ?? 0) % 2 !== 0) return true
  if ((trimmed.match(/`/g)?.length ?? 0) % 2 !== 0) return true
  if (lastLine.startsWith('|') && !lastLine.endsWith('|')) return true
  if (/^[|*-]?\s*\*\*[^*\n]{1,80}$/.test(lastLine)) return true

  if (trimmed.length < 80) return false

  if (/[\u2014:：,，、;；(（[［{｛《“"']$/.test(trimmed)) return true
  if (/^\d+[.、)]\s*$/.test(lastLine)) return true
  if (/^\d{1,4}$/.test(lastLine)) return true
  if (/^\d+[.、)]\s+["“]?[^"”。.!！？?]*$/.test(lastLine)) return true
  if (/[\p{L}\p{N})）\]］】》]$/u.test(lastLine) && !/[。.!！?？]$/.test(lastLine)) {
    const words = lastLine.split(/\s+/).filter(Boolean)
    if (lastLine.length < 48 || words.length <= 8) return true
  }

  return false
}

export async function runTAORLoop(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  res: Response,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const msgs = messages.map(m => ({ ...m } as any))
  let autoContinueRounds = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    await sendChatStatus(res, 'thinking', '准备生成回复')
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    try {
      stream = await withTimeout(
        client.chat.completions.create({
          model,
          messages: msgs as any,
          tools: tools.length > 0 ? tools : undefined,
          stream: true,
        }),
        STREAM_START_TIMEOUT_MS,
        '模型服务响应超时，请稍后重试或切换其他模型。',
      )
    } catch (err: any) {
      const message = err?.message || 'model stream failed'
      await writeSSE(res, { type: 'message_complete', finishReason: 'error', incomplete: true } as ToolCallEvent)
      await writeSSE(res, { type: 'status', state: 'idle', label: '失败' } as ToolCallEvent)
      await writeSSE(res, { type: 'error', error: message })
      await finishStream(res)
      return msgs
    }

    const timeout = setTimeout(() => {
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'stream timeout' })}\n\n`)
        res.end()
      }
    }, STREAM_TIMEOUT_MS)

    let finishReason: string | null = null
    let assistantContent = ''
    let textBlockId: string | null = null
    const toolAccumulators = new Map<number, ToolCallAccumulator>()

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta

        const reasoningContent = (delta as any)?.reasoning_content
          ?? (delta as any)?.reasoning
          ?? (delta as any)?.thinking

        if (typeof reasoningContent === 'string' && reasoningContent) {
          await writeSSE(res, {
            type: 'thinking_delta',
            content: reasoningContent,
          } as ToolCallEvent)
        }

        // --- text content: forward to client ---
        if (delta?.content) {
          let text: string = delta.content
          text = text.replace(KIMI_TOOL_RE, '')
          if (text) {
            if (!textBlockId) {
              textBlockId = `text-${Date.now()}-${round + 1}`
              await writeSSE(res, {
                type: 'content_start',
                blockType: 'text',
                blockId: textBlockId,
              } as ToolCallEvent)
            }
            assistantContent += text
            await writeSSE(res, { type: 'content_delta', blockId: textBlockId, text } as ToolCallEvent)
          }
        }

        // --- accumulate streaming tool call deltas ---
        if (delta?.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index ?? 0
            if (!toolAccumulators.has(idx)) {
              toolAccumulators.set(idx, {
                id: tcDelta.id || '',
                name: tcDelta.function?.name || '',
                arguments: tcDelta.function?.arguments || '',
              })
            } else {
              const acc = toolAccumulators.get(idx)!
              if (tcDelta.id) acc.id = tcDelta.id
              if (tcDelta.function?.name) acc.name = tcDelta.function.name
              if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason
        }
      }
    } finally {
      clearTimeout(timeout)
    }

    console.log(
      `[chat] round=${round + 1}, finish=${finishReason || 'none'}, chars=${assistantContent.length}, tools=${toolAccumulators.size}`,
    )

    // --- model wants to call tools ---
    if (finishReason === 'tool_calls' && toolAccumulators.size > 0) {
      const assistantMsg: any = {
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: [] as any[],
      }

      const toolCalls = [...toolAccumulators.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(acc.arguments) } catch { /* keep empty */ }

          assistantMsg.tool_calls.push({
            id: acc.id,
            type: 'function',
            function: { name: acc.name, arguments: acc.arguments },
          })

          return { ...acc, args }
        })

      // OpenAI-compatible message ordering requires the assistant tool_calls
      // message to appear before the corresponding tool result messages.
      msgs.push(assistantMsg)

      for (const acc of toolCalls) {
        // notify frontend: tool call started
        await writeSSE(res, {
          type: 'tool_call', id: acc.id, name: acc.name, arguments: acc.args, status: 'running',
        } as ToolCallEvent)
        await writeSSE(res, {
          type: 'status',
          state: 'tool_executing',
          label: `运行云端工具 ${acc.name}`,
        } as ToolCallEvent)

        // execute the tool
        let toolResult
        let isError = false
        let toolStatus: 'done' | 'error' | 'timeout' = 'done'
        try {
          toolResult = await Promise.race([
            mcpManager.executeTool(acc.name, acc.args),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('tool timeout after 30s')), 30_000)),
          ])
        } catch (err: any) {
          isError = true
          toolStatus = err?.message?.includes('timeout') ? 'timeout' : 'error'
          toolResult = { content: [{ type: 'text', text: `Error: ${err.message}` }] }
        }

        const content = toolResult?.content?.map((c: any) => c.text || '').join('\n')
          || JSON.stringify(toolResult)

        // notify frontend: tool result
        await writeSSE(res, {
          type: 'tool_result', id: acc.id, name: acc.name, result: content.slice(0, 2000), isError,
        } as ToolCallEvent)
        await writeSSE(res, {
          type: 'tool_end', id: acc.id, status: toolStatus,
        } as ToolCallEvent)

        // append tool result to messages for next round
        msgs.push({ role: 'tool', tool_call_id: acc.id, content } as any)
      }

      // continue to next round — model sees tool results and may call more tools or answer
      continue
    }

    // --- model finished (stop, length, content_filter, etc.) ---
    const shouldContinue = finishReason === 'length' || looksAbrupt(assistantContent)
    if (shouldContinue && assistantContent && autoContinueRounds < MAX_AUTO_CONTINUE_ROUNDS) {
      autoContinueRounds++
      console.log(`[chat] auto-continue ${autoContinueRounds}/${MAX_AUTO_CONTINUE_ROUNDS}`)
      msgs.push({ role: 'assistant', content: assistantContent } as any)
      msgs.push({ role: 'user', content: CONTINUE_PROMPT } as any)
      continue
    }

    if (finishReason === 'length' && autoContinueRounds >= MAX_AUTO_CONTINUE_ROUNDS) {
      const text = '\n\n[输出达到长度上限，请发送“继续”获取剩余内容。]'
      if (!textBlockId) {
        textBlockId = `text-${Date.now()}-${round + 1}`
        await writeSSE(res, { type: 'content_start', blockType: 'text', blockId: textBlockId } as ToolCallEvent)
      }
      await writeSSE(res, { type: 'content_delta', blockId: textBlockId, text } as ToolCallEvent)
    }
    await writeSSE(res, {
      type: 'message_complete',
      finishReason,
      incomplete: finishReason === 'length' || looksAbrupt(assistantContent),
    } as ToolCallEvent)
    await writeSSE(res, { type: 'status', state: 'idle', label: '完成' } as ToolCallEvent)
    await finishStream(res)
    return msgs
  }

  // exhausted all rounds
  await writeSSE(res, { type: 'message_complete', finishReason: 'max_tool_rounds', incomplete: true } as ToolCallEvent)
  await writeSSE(res, { type: 'status', state: 'idle', label: '完成' } as ToolCallEvent)
  await finishStream(res)
  return msgs
}
