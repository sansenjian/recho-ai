/// <reference lib="webworker" />

import { createSSEEventParser } from '../utils/sse-events'

type WorkerMessage =
  | { type: 'chunk'; data: ArrayBuffer }
  | { type: 'flush' }
  | { type: 'reset' }

const decoder = new TextDecoder()
const parser = createSSEEventParser(event => self.postMessage(event))

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data

  if (msg.type === 'reset') {
    decoder.decode()
    parser.reset()
    self.postMessage({ type: 'done' } as const)
    return
  }

  if (msg.type === 'flush') {
    parser.pushText(decoder.decode())
    parser.flush()
    return
  }

  parser.pushText(decoder.decode(msg.data, { stream: true }))
}
