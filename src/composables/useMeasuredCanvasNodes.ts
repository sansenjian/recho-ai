import { ref, type ComponentPublicInstance } from 'vue'
import { NODE_SIZE, type CanvasNode, type NodeDimensions } from '../lib/image-canvas-model'
import { getNodeScale } from '../lib/image-canvas-utils'

interface UseMeasuredCanvasNodesOptions {
  getNodeById: (nodeId: string) => CanvasNode | null | undefined
  referenceCountForNode: (node: CanvasNode) => number
}

function childFlowBottom(element: HTMLElement) {
  return Array.from(element.children).reduce((max, child) => {
    if (!(child instanceof HTMLElement)) return max
    const style = getComputedStyle(child)
    if (style.position === 'absolute' || style.position === 'fixed') return max
    const marginBottom = Number.parseFloat(style.marginBottom) || 0
    return Math.max(max, child.offsetTop + Math.max(child.scrollHeight, child.offsetHeight) + marginBottom)
  }, 0)
}

function naturalMeasuredNodeHeight(element: HTMLElement) {
  const style = getComputedStyle(element)
  const borderHeight = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0)
  return Math.ceil(childFlowBottom(element) + borderHeight)
}

export function useMeasuredCanvasNodes(options: UseMeasuredCanvasNodesOptions) {
  const measuredNodeHeights = ref<Record<string, number>>({})
  const measuredNodeElements = new Map<string, HTMLElement>()
  const measuredNodeResizeObservers = new Map<string, ResizeObserver>()
  const measuredNodeMutationObservers = new Map<string, MutationObserver>()
  const measuredNodeUpdateFrames = new Map<string, number>()
  const measuredNodeRefCallbacks = new Map<string, (element: Element | ComponentPublicInstance | null) => void>()

  function updateMeasuredNodeHeight(nodeId: string) {
    measuredNodeUpdateFrames.delete(nodeId)
    const element = measuredNodeElements.get(nodeId)
    if (!element) return

    const node = options.getNodeById(nodeId)
    if (!node) return
    const naturalHeight = naturalMeasuredNodeHeight(element)
    const measuredHeight = node.type === 'image'
      ? naturalHeight
      : Math.max(NODE_SIZE[node.type].height, naturalHeight)
    if (measuredNodeHeights.value[nodeId] === measuredHeight) return
    measuredNodeHeights.value = {
      ...measuredNodeHeights.value,
      [nodeId]: measuredHeight,
    }
  }

  function scheduleMeasuredNodeHeightUpdate(nodeId: string) {
    if (measuredNodeUpdateFrames.has(nodeId)) return
    const frame = window.requestAnimationFrame(() => updateMeasuredNodeHeight(nodeId))
    measuredNodeUpdateFrames.set(nodeId, frame)
  }

  function cleanupMeasuredNodeElement(nodeId: string) {
    measuredNodeResizeObservers.get(nodeId)?.disconnect()
    measuredNodeResizeObservers.delete(nodeId)
    measuredNodeMutationObservers.get(nodeId)?.disconnect()
    measuredNodeMutationObservers.delete(nodeId)
    const frame = measuredNodeUpdateFrames.get(nodeId)
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame)
      measuredNodeUpdateFrames.delete(nodeId)
    }
    measuredNodeElements.delete(nodeId)
    measuredNodeRefCallbacks.delete(nodeId)
    if (measuredNodeHeights.value[nodeId] !== undefined) {
      const remainingHeights = { ...measuredNodeHeights.value }
      delete remainingHeights[nodeId]
      measuredNodeHeights.value = remainingHeights
    }
  }

  function setMeasuredNodeElement(nodeId: string, value: Element | ComponentPublicInstance | null) {
    let element: HTMLElement | null = null
    if (value instanceof HTMLElement) {
      element = value
    } else if (value && !(value instanceof Element) && value.$el instanceof HTMLElement) {
      element = value.$el
    }
    const existingElement = measuredNodeElements.get(nodeId)
    if (existingElement === element) return

    measuredNodeResizeObservers.get(nodeId)?.disconnect()
    measuredNodeResizeObservers.delete(nodeId)
    measuredNodeMutationObservers.get(nodeId)?.disconnect()
    measuredNodeMutationObservers.delete(nodeId)

    if (!element) {
      cleanupMeasuredNodeElement(nodeId)
      return
    }

    measuredNodeElements.set(nodeId, element)
    const resizeObserver = new ResizeObserver(() => scheduleMeasuredNodeHeightUpdate(nodeId))
    element.querySelectorAll<HTMLElement>('.node-header, .node-textarea, .image-preview, .image-output-panel, .image-caption, .image-node-actions, .generation-body, .generation-scroll, .generation-footer')
      .forEach(item => resizeObserver.observe(item))
    const mutationObserver = new MutationObserver(() => scheduleMeasuredNodeHeightUpdate(nodeId))
    mutationObserver.observe(element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    measuredNodeResizeObservers.set(nodeId, resizeObserver)
    measuredNodeMutationObservers.set(nodeId, mutationObserver)
    scheduleMeasuredNodeHeightUpdate(nodeId)
  }

  function measuredNodeRef(nodeId: string) {
    const existingCallback = measuredNodeRefCallbacks.get(nodeId)
    if (existingCallback) return existingCallback

    const callback = (value: Element | ComponentPublicInstance | null) => {
      setMeasuredNodeElement(nodeId, value)
    }
    measuredNodeRefCallbacks.set(nodeId, callback)
    return callback
  }

  function getBaseNodeSize(node: CanvasNode): NodeDimensions {
    const size = NODE_SIZE[node.type]
    if (node.type === 'image') {
      const measuredHeight = measuredNodeHeights.value[node.id]
      return { ...size, height: measuredHeight ?? size.height }
    }

    if (node.type === 'generation') {
      const referenceCount = options.referenceCountForNode(node)
      const extraReferenceHeight = Math.max(0, referenceCount - 1) * 30
      const baseHeight = size.height + extraReferenceHeight
      return { ...size, height: Math.max(baseHeight, measuredNodeHeights.value[node.id] ?? 0) }
    }
    return { ...size, height: Math.max(size.height, measuredNodeHeights.value[node.id] ?? 0) }
  }

  function getRenderedNodeSize(node: CanvasNode): NodeDimensions {
    const scale = getNodeScale(node)
    const size = getBaseNodeSize(node)
    return {
      width: size.width * scale,
      height: size.height * scale,
    }
  }

  function clearMeasuredNodes() {
    measuredNodeResizeObservers.forEach(observer => observer.disconnect())
    measuredNodeResizeObservers.clear()
    measuredNodeMutationObservers.forEach(observer => observer.disconnect())
    measuredNodeMutationObservers.clear()
    measuredNodeUpdateFrames.forEach(frame => window.cancelAnimationFrame(frame))
    measuredNodeUpdateFrames.clear()
    measuredNodeElements.clear()
    measuredNodeRefCallbacks.clear()
    measuredNodeHeights.value = {}
  }

  return {
    measuredNodeHeights,
    cleanupMeasuredNodeElement,
    measuredNodeRef,
    getBaseNodeSize,
    getRenderedNodeSize,
    clearMeasuredNodes,
  }
}
