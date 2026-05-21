/// <reference lib="webworker" />

// SSE 流解析 Worker：接收原始字节流，解析出 delta 文本，发回主线程

type WorkerMessage =
  | { type: 'chunk'; data: ArrayBuffer }
  | { type: 'flush' }
  | { type: 'reset' }

const decoder = new TextDecoder()

// 过滤思考标签 <thinking>...</thinking>，支持跨 chunk
let thinkBuf = ''
let inThink = false

function filterThinking(delta: string): string {
  thinkBuf += delta
  let out = ''
  let i = 0
  while (i < thinkBuf.length) {
    if (inThink) {
      const endTag = thinkBuf.toLowerCase().indexOf('</thinking>', i)
      if (endTag === -1) { thinkBuf = ''; return out }
      inThink = false
      i = endTag + '</thinking>'.length
    } else {
      const startTag = thinkBuf.toLowerCase().indexOf('<thinking>', i)
      if (startTag === -1) { out += thinkBuf.slice(i); thinkBuf = ''; return out }
      out += thinkBuf.slice(i, startTag)
      i = startTag + '<thinking>'.length
      inThink = true
    }
  }
  thinkBuf = ''
  return out
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data

  if (msg.type === 'reset' || msg.type === 'flush') {
    // flush 时清空思考缓冲区
    thinkBuf = ''
    inThink = false
    self.postMessage({ type: 'done' } as const)
    return
  }

  if (msg.type === 'chunk') {
    const chunk = decoder.decode(msg.data, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') {
        self.postMessage({ type: 'done' } as const)
        continue
      }
      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue
        // 跳过纯思考 delta（reasoning_content 非空但 content 为空）
        if (delta.reasoning_content && !delta.content) continue
        const content = delta.content
        if (content) {
          const filtered = filterThinking(content)
          if (filtered) {
            self.postMessage({ type: 'delta', content: filtered } as const)
          }
        }
      } catch { /* skip malformed */ }
    }
  }
}
