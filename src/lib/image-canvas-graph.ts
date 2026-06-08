import { isOutputHandle } from './canvas-document'
import {
  TEXT_NODE_CONTENT_SCALE_FACTOR,
  type CanvasHandle,
  type CanvasNode,
  type HandleRole,
  type InputHandle,
  type NodeDimensions,
  type OutputHandle,
} from './image-canvas-model'
import { getNodeScale, imagePreviewHeight } from './image-canvas-utils'

export function handleRole(handle: CanvasHandle): HandleRole {
  return isOutputHandle(handle) ? 'output' : 'input'
}

export function outputHandlesForNode(node: CanvasNode): OutputHandle[] {
  if (node.type === 'text') return ['text-out']
  if (node.type === 'image') return ['image-out']
  return ['generation-out']
}

export function inputHandlesForNode(node: CanvasNode): InputHandle[] {
  if (node.type === 'image') return ['image-in']
  if (node.type === 'generation') return ['prompt-in', 'reference-in']
  return []
}

export function nodeStyle(node: CanvasNode, size: NodeDimensions) {
  const scale = getNodeScale(node)
  const textContentScale = node.type === 'text'
    ? (1 + (scale - 1) * TEXT_NODE_CONTENT_SCALE_FACTOR) / scale
    : 1
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    transform: `translate(${node.x}px, ${node.y}px) scale(${scale})`,
    transformOrigin: '0 0',
    '--node-text-content-scale': textContentScale.toFixed(4),
    '--image-preview-height': `${imagePreviewHeight(node)}px`,
  }
}

export function handlePoint(
  node: CanvasNode | undefined,
  handle: OutputHandle | InputHandle,
  size: NodeDimensions,
) {
  if (!node) return { x: 0, y: 0 }
  const scale = getNodeScale(node)

  if (handle === 'text-out') return { x: node.x + size.width, y: node.y + 78 * scale }
  if (handle === 'image-in') return { x: node.x, y: node.y + size.height / 2 }
  if (handle === 'image-out') return { x: node.x + size.width, y: node.y + size.height / 2 }
  if (handle === 'prompt-in') return { x: node.x, y: node.y + 90 * scale }
  if (handle === 'reference-in') return { x: node.x, y: node.y + 174 * scale }
  return { x: node.x + size.width, y: node.y + 188 * scale }
}

export function curvePath(startX: number, startY: number, endX: number, endY: number) {
  const distance = Math.max(80, Math.abs(endX - startX) * 0.48)
  return `M ${startX} ${startY} C ${startX + distance} ${startY}, ${endX - distance} ${endY}, ${endX} ${endY}`
}
