import { describe, expect, it } from 'vitest'
import {
  createInitialCanvasDocumentState,
  useImageCanvasDocument,
} from '../src/composables/useImageCanvasDocument'

describe('image canvas document', () => {
  it('replaces the current document with an independent fresh canvas', () => {
    const document = useImageCanvasDocument()
    const originalFirstNodeId = document.nodes.value[0]?.id

    document.nodes.value[0]!.content = '旧工作区内容'

    const freshCanvas = createInitialCanvasDocumentState()
    document.replaceDocument(freshCanvas)

    expect(document.nodes.value[0]?.content).toBe('')
    expect(document.nodes.value[0]?.id).toBe(originalFirstNodeId)

    freshCanvas.nodes[0]!.content = '不应影响当前画布'
    expect(document.nodes.value[0]?.content).toBe('')
  })
})
