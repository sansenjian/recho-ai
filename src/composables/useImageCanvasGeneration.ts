import type { Ref } from 'vue'
import {
  NODE_SIZE,
  type CanvasNode,
  type Connection,
  type NodeDimensions,
  type NodeGenerationCount,
} from '../lib/image-canvas-model'
import { imageDimensionsFromHistory } from '../lib/image-canvas-utils'
import { previewImageUrl } from '../lib/image-gallery'
import type {
  GeneratedImage,
  ImageCanvasContext,
  ImageGenReference,
  ImageGenRequest,
} from '../types/image'

type ImageGenOptions = Omit<ImageGenRequest, 'prompt'>

interface PromptParts {
  userPrompt: string
  systemPrompt: string
  modelPrompt: string
}

export interface UseImageCanvasGenerationOptions {
  nodes: Ref<CanvasNode[]>
  connections: Ref<Connection[]>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
  canSelectGenerationCount: () => boolean
  canvasContextEnabled: () => boolean
  createNode: (type: 'image' | 'generation', x: number, y: number, data?: Partial<CanvasNode>) => CanvasNode
  createConnectionId: () => string
  getRenderedNodeSize: (node: CanvasNode) => NodeDimensions
  buildReferences: (node: CanvasNode) => Promise<ImageGenReference[]>
  buildPromptParts: (node: CanvasNode) => PromptParts
  buildCanvasContext: (node: CanvasNode, userPrompt: string) => ImageCanvasContext
  generate: (prompt: string, options?: ImageGenOptions) => Promise<GeneratedImage[] | null>
}

export const generationCountOptions: Array<{ value: NodeGenerationCount; label: string }> = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 8, label: '8' },
]

const generationCountValues = new Set<NodeGenerationCount>(generationCountOptions.map(option => option.value))

function nextOutputImageTitleIndex(nodes: CanvasNode[]) {
  return nodes.reduce((max, item) => {
    if (item.type !== 'image') return max
    const match = /^图片(\d+)$/.exec(item.title.trim())
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
}

export function useImageCanvasGeneration(options: UseImageCanvasGenerationOptions) {
  function generationCountForNode(node: CanvasNode): NodeGenerationCount {
    return generationCountValues.has(node.count as NodeGenerationCount) ? node.count as NodeGenerationCount : 1
  }

  function setGenerationCount(node: CanvasNode, count: NodeGenerationCount) {
    if (!options.canSelectGenerationCount()) return
    node.count = count
  }

  async function generateFromNode(node: CanvasNode) {
    if (options.isGenerating.value || node.loading) return
    const { userPrompt, systemPrompt, modelPrompt } = options.buildPromptParts(node)
    if (!userPrompt.trim()) {
      node.error = '请连接文本节点或填写提示词。'
      return
    }

    node.loading = true
    node.error = null
    node.status = '正在准备生成...'
    try {
      const references = await options.buildReferences(node)
      const canvasContext = options.canvasContextEnabled()
        ? options.buildCanvasContext(node, userPrompt)
        : undefined
      const generationCount = options.canSelectGenerationCount() ? generationCountForNode(node) : 1
      node.status = references.length
        ? `正在上传 ${references.length} 张参考图并生成 ${generationCount} 张图片...`
        : `正在生成 ${generationCount} 张图片...`
      const results = await options.generate(modelPrompt, {
        userPrompt,
        systemPrompt,
        modelPrompt,
        aspectRatio: node.aspectRatio,
        resolution: node.resolution,
        quality: node.quality,
        count: generationCount,
        references,
        ...(canvasContext ? { canvasContext } : {}),
      })

      if (!results?.length) {
        node.error = options.error.value || '生成失败'
        return
      }

      const outputColumns = Math.min(2, results.length)
      const outputX = node.x + NODE_SIZE.generation.width + 132
      const outputY = node.y + 46
      let nextTitleIndex = nextOutputImageTitleIndex(options.nodes.value)
      const outputNodes = results.map((result, index) => {
        nextTitleIndex += 1
        return options.createNode(
          'image',
          outputX + (index % outputColumns) * (NODE_SIZE.image.width + 28),
          outputY + Math.floor(index / outputColumns) * (NODE_SIZE.image.height + 28),
          {
            title: `图片${nextTitleIndex}`,
            content: '',
            imageUrl: previewImageUrl(result),
            storagePath: result.storagePath,
            sourceImageId: result.id,
            sourceHistoryScope: 'mine',
            sourcePrompt: result.prompt,
            fileName: result.size,
            ...imageDimensionsFromHistory(result),
          },
        )
      })

      options.connections.value = [
        ...options.connections.value,
        ...outputNodes.map((outputNode): Connection => ({
          id: options.createConnectionId(),
          fromNodeId: node.id,
          fromHandle: 'generation-out',
          toNodeId: outputNode.id,
          toHandle: 'image-in',
        })),
      ]
    } catch (err) {
      node.error = err instanceof Error ? err.message : '生成失败'
    } finally {
      node.loading = false
      node.status = null
    }
  }

  function createContinuation(node: CanvasNode) {
    const imageSize = options.getRenderedNodeSize(node)
    const generationNode = options.createNode('generation', node.x + imageSize.width + 132, node.y - 18, {
      title: '继续生成',
    })

    options.connections.value = [
      ...options.connections.value,
      {
        id: options.createConnectionId(),
        fromNodeId: node.id,
        fromHandle: 'image-out',
        toNodeId: generationNode.id,
        toHandle: 'reference-in',
      },
    ]
  }

  return {
    generationCountOptions,
    generationCountForNode,
    setGenerationCount,
    generateFromNode,
    createContinuation,
  }
}
