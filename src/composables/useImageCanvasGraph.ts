import { computed, ref, type Ref } from 'vue'
import { isInputHandle, isOutputHandle, isValidCanvasConnection } from '../lib/canvas-document'
import * as canvasGraph from '../lib/image-canvas-graph'
import * as canvasPrompt from '../lib/image-canvas-prompt'
import {
  type CanvasHandle,
  type CanvasNode,
  type Connection,
  type DraftConnection,
  type InputHandle,
  type NodeDimensions,
  type OutputHandle,
  type PendingMenuConnection,
} from '../lib/image-canvas-model'

interface CanvasPoint {
  x: number
  y: number
}

export interface UseImageCanvasGraphOptions {
  canvasId: string
  canvasVersion: number
  nodes: Ref<CanvasNode[]>
  connections: Ref<Connection[]>
  getNodeById: (nodeId: string) => CanvasNode | null | undefined
  createConnectionId: () => string
  getBaseNodeSize: (node: CanvasNode) => NodeDimensions
  getRenderedNodeSize: (node: CanvasNode) => NodeDimensions
  canvasPointFromClient: (clientX: number, clientY: number) => CanvasPoint
  canStartPointerInteraction: (event: PointerEvent) => boolean
  selectNode: (nodeId: string) => void
}

export function useImageCanvasGraph(options: UseImageCanvasGraphOptions) {
  const draftConnection = ref<DraftConnection | null>(null)

  function addConnectionIfValid(
    fromNodeId: string,
    fromHandle: OutputHandle,
    toNodeId: string,
    toHandle: InputHandle,
  ) {
    if (!isValidCanvasConnection(options.nodes.value, fromNodeId, fromHandle, toNodeId, toHandle)) return false

    const isDuplicate = options.connections.value.some(conn => (
      conn.fromNodeId === fromNodeId &&
      conn.fromHandle === fromHandle &&
      conn.toNodeId === toNodeId &&
      conn.toHandle === toHandle
    ))

    if (isDuplicate) return true

    options.connections.value = [
      ...options.connections.value,
      {
        id: options.createConnectionId(),
        fromNodeId,
        fromHandle,
        toNodeId,
        toHandle,
      },
    ]

    const targetNode = options.getNodeById(toNodeId)
    if (targetNode?.type === 'generation' && toHandle === 'prompt-in') {
      syncMentionConnectionsForGeneration(targetNode)
    }

    return true
  }

  function startConnection(event: PointerEvent, node: CanvasNode, handle: CanvasHandle) {
    if (!options.canStartPointerInteraction(event)) return
    event.preventDefault()
    options.selectNode(node.id)
    const point = options.canvasPointFromClient(event.clientX, event.clientY)
    draftConnection.value = {
      nodeId: node.id,
      handle,
      role: canvasGraph.handleRole(handle),
      cursorX: point.x,
      cursorY: point.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
    }
  }

  function finishConnection(event: PointerEvent, targetNode: CanvasNode, targetHandle: CanvasHandle) {
    const draft = draftConnection.value
    if (!draft) return
    event.preventDefault()
    event.stopPropagation()

    if (draft.role === 'output' && isOutputHandle(draft.handle) && isInputHandle(targetHandle)) {
      addConnectionIfValid(draft.nodeId, draft.handle, targetNode.id, targetHandle)
    } else if (draft.role === 'input' && isInputHandle(draft.handle) && isOutputHandle(targetHandle)) {
      addConnectionIfValid(targetNode.id, targetHandle, draft.nodeId, draft.handle)
    }

    draftConnection.value = null
  }

  function connectPendingMenuConnection(pending: PendingMenuConnection, node: CanvasNode) {
    if (pending.role === 'output' && isOutputHandle(pending.handle)) {
      for (const targetHandle of canvasGraph.inputHandlesForNode(node)) {
        if (addConnectionIfValid(pending.nodeId, pending.handle, node.id, targetHandle)) return
      }
    }

    if (pending.role === 'input' && isInputHandle(pending.handle)) {
      for (const sourceHandle of canvasGraph.outputHandlesForNode(node)) {
        if (addConnectionIfValid(node.id, sourceHandle, pending.nodeId, pending.handle)) return
      }
    }
  }

  function updateDraftCursor(clientX: number, clientY: number) {
    if (!draftConnection.value) return
    const point = options.canvasPointFromClient(clientX, clientY)
    draftConnection.value = {
      ...draftConnection.value,
      cursorX: point.x,
      cursorY: point.y,
    }
  }

  function pendingConnectionForPointerUp(event: PointerEvent): PendingMenuConnection | null {
    const draft = draftConnection.value
    if (!draft) return null

    const deltaX = event.clientX - draft.startClientX
    const deltaY = event.clientY - draft.startClientY
    if (Math.hypot(deltaX, deltaY) < 12) return null

    return {
      nodeId: draft.nodeId,
      handle: draft.handle,
      role: draft.role,
    }
  }

  function clearDraftConnection() {
    draftConnection.value = null
  }

  function incomingConnections(nodeId: string, handle?: InputHandle) {
    return canvasPrompt.incomingConnections(options.connections.value, nodeId, handle)
  }

  function imageNodeForRichToken(id?: string, title?: string) {
    return canvasPrompt.imageNodeForRichToken(options.nodes.value, id, title)
  }

  function promptMentionedImageNodesForGeneration(node: CanvasNode) {
    return canvasPrompt.promptMentionedImageNodesForGeneration(options.nodes.value, options.connections.value, node)
  }

  function referencedImageNodes(node: CanvasNode) {
    return canvasPrompt.referencedImageNodes(options.nodes.value, options.connections.value, node)
  }

  function syncMentionConnectionsForGeneration(node: CanvasNode) {
    if (node.type !== 'generation') return
    const mentionedIds = new Set(promptMentionedImageNodesForGeneration(node).map(item => item.id))

    options.connections.value = options.connections.value.filter(conn => (
      conn.toNodeId !== node.id ||
      conn.toHandle !== 'reference-in' ||
      !conn.managedByMention ||
      mentionedIds.has(conn.fromNodeId)
    ))

    const nextConnections = [...options.connections.value]
    for (const imageNodeId of mentionedIds) {
      const exists = nextConnections.some(conn => (
        conn.fromNodeId === imageNodeId &&
        conn.fromHandle === 'image-out' &&
        conn.toNodeId === node.id &&
        conn.toHandle === 'reference-in'
      ))
      if (!exists) {
        nextConnections.push({
          id: options.createConnectionId(),
          fromNodeId: imageNodeId,
          fromHandle: 'image-out',
          toNodeId: node.id,
          toHandle: 'reference-in',
          managedByMention: true,
        })
      }
    }
    options.connections.value = nextConnections
  }

  function syncMentionConnectionsForTextNode(node: CanvasNode) {
    if (node.type !== 'text') return
    for (const conn of options.connections.value) {
      if (conn.fromNodeId !== node.id || conn.toHandle !== 'prompt-in') continue
      const target = options.getNodeById(conn.toNodeId)
      if (target?.type === 'generation') {
        syncMentionConnectionsForGeneration(target)
      }
    }
  }

  function nodeStyle(node: CanvasNode) {
    return canvasGraph.nodeStyle(node, options.getBaseNodeSize(node))
  }

  function handlePoint(nodeId: string, handle: OutputHandle | InputHandle) {
    const node = options.getNodeById(nodeId)
    return canvasGraph.handlePoint(
      node ?? undefined,
      handle,
      node ? options.getRenderedNodeSize(node) : { width: 0, height: 0 },
    )
  }

  function connectionPath(connection: Connection) {
    const start = handlePoint(connection.fromNodeId, connection.fromHandle)
    const end = handlePoint(connection.toNodeId, connection.toHandle)
    return canvasGraph.curvePath(start.x, start.y, end.x, end.y)
  }

  const draftPath = computed(() => {
    const draft = draftConnection.value
    if (!draft) return ''
    const start = handlePoint(draft.nodeId, draft.handle)
    return canvasGraph.curvePath(start.x, start.y, draft.cursorX, draft.cursorY)
  })

  function hasPromptLink(node: CanvasNode) {
    return canvasPrompt.hasPromptLink(options.connections.value, node)
  }

  function getGenerationPromptValue(node: CanvasNode) {
    return canvasPrompt.getGenerationPromptValue(options.nodes.value, options.connections.value, node)
  }

  function buildPromptParts(node: CanvasNode) {
    syncMentionConnectionsForGeneration(node)
    return canvasPrompt.buildPromptParts(options.nodes.value, options.connections.value, node)
  }

  function buildCanvasContext(node: CanvasNode, userPrompt: string) {
    return canvasPrompt.buildCanvasContext({
      canvasId: options.canvasId,
      canvasVersion: options.canvasVersion,
      nodes: options.nodes.value,
      connections: options.connections.value,
      node,
      userPrompt,
    })
  }

  return {
    draftPath,
    startConnection,
    finishConnection,
    connectPendingMenuConnection,
    updateDraftCursor,
    pendingConnectionForPointerUp,
    clearDraftConnection,
    incomingConnections,
    imageNodeForRichToken,
    referencedImageNodes,
    syncMentionConnectionsForGeneration,
    syncMentionConnectionsForTextNode,
    nodeStyle,
    handlePoint,
    connectionPath,
    hasPromptLink,
    getGenerationPromptValue,
    buildPromptParts,
    buildCanvasContext,
  }
}
