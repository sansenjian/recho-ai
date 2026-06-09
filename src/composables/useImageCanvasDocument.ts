import { ref } from 'vue'
import {
  normalizeCanvasImport,
  type CanvasExportDocument,
  type CanvasViewportState,
} from '../lib/canvas-document'
import {
  MAX_NODE_SCALE,
  MAX_VIEWPORT_ZOOM,
  MIN_NODE_SCALE,
  MIN_VIEWPORT_ZOOM,
  type CanvasNode,
  type CanvasNodeType,
  type Connection,
  type NodeGenerationCount,
} from '../lib/image-canvas-model'

export interface ImportedCanvasDocument {
  append: boolean
  nodes: CanvasNode[]
  connections: Connection[]
  viewport: CanvasViewportState
}

const INITIAL_NODES: CanvasNode[] = [
  {
    id: 'node_text_seed',
    type: 'text',
    x: 320,
    y: 120,
    title: '文本',
    content: '',
    size: '1024x1024',
    aspectRatio: 'auto',
    resolution: 'auto',
    quality: 'auto',
  },
  {
    id: 'node_generation_seed',
    type: 'generation',
    x: 820,
    y: 104,
    title: '图片生成',
    content: '',
    size: 'auto',
    aspectRatio: 'auto',
    resolution: 'auto',
    quality: 'auto',
    count: 1,
  },
]

const INITIAL_CONNECTIONS: Connection[] = [
  {
    id: 'conn_seed_text_generation',
    fromNodeId: 'node_text_seed',
    fromHandle: 'text-out',
    toNodeId: 'node_generation_seed',
    toHandle: 'prompt-in',
  },
]

function cloneNode(node: CanvasNode): CanvasNode {
  return {
    ...node,
    mentions: node.mentions ? [...node.mentions] : undefined,
  }
}

function cleanNodeCopy(node: CanvasNode): CanvasNode {
  return {
    ...cloneNode(node),
    loading: false,
    status: null,
    error: null,
  }
}

function defaultNodeTitle(type: CanvasNodeType) {
  const labels: Record<CanvasNodeType, string> = {
    text: '文本',
    image: '图片',
    generation: '图片生成',
  }
  return labels[type]
}

export function useImageCanvasDocument() {
  let idSeed = Date.now()
  const canvasId = `canvas_${idSeed}`
  const nodes = ref<CanvasNode[]>(INITIAL_NODES.map(cloneNode))
  const connections = ref<Connection[]>(INITIAL_CONNECTIONS.map(connection => ({ ...connection })))
  const selectedNodeId = ref<string | null>('node_generation_seed')
  const nodeClipboard = ref<CanvasNode | null>(null)

  function createId(prefix: string) {
    idSeed += 1
    return `${prefix}_${idSeed}`
  }

  function getNodeById(nodeId: string) {
    return nodes.value.find(node => node.id === nodeId)
  }

  function nextImageTitle(excludeNodeId?: string) {
    const maxIndex = nodes.value.reduce((max, node) => {
      if (node.type !== 'image' || node.id === excludeNodeId) return max
      const match = /^图片(\d+)$/.exec(node.title.trim())
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    return `图片${maxIndex + 1}`
  }

  function createNode(type: CanvasNodeType, x: number, y: number, data: Partial<CanvasNode> = {}) {
    const node: CanvasNode = {
      id: createId(type),
      type,
      x,
      y,
      title: defaultNodeTitle(type),
      content: '',
      size: 'auto',
      aspectRatio: 'auto',
      resolution: 'auto',
      quality: 'auto',
      ...(type === 'generation' ? { count: 1 as NodeGenerationCount } : {}),
      scale: 1,
      ...data,
    }

    nodes.value = [...nodes.value, node]
    selectedNodeId.value = node.id
    return node
  }

  function duplicatedNodeTitle(node: CanvasNode) {
    if (node.type === 'image' && /^图片\d+$/.test(node.title.trim())) {
      return nextImageTitle()
    }

    const title = node.title.trim() || '节点'
    return `${title} 副本`.slice(0, 48)
  }

  function insertNodeCopy(node: CanvasNode) {
    const duplicate: CanvasNode = {
      ...cleanNodeCopy(node),
      id: createId(node.type),
      x: node.x + 36,
      y: node.y + 36,
      title: duplicatedNodeTitle(node),
    }
    nodes.value = [...nodes.value, duplicate]
    selectedNodeId.value = duplicate.id
    return duplicate
  }

  function copyNodeToClipboard(node: CanvasNode) {
    nodeClipboard.value = cleanNodeCopy(node)
  }

  function copySelectedNode() {
    const node = selectedNodeId.value ? getNodeById(selectedNodeId.value) : null
    if (!node) return false
    copyNodeToClipboard(node)
    return true
  }

  function pasteNodeFromClipboard() {
    if (!nodeClipboard.value) return false
    const duplicate = insertNodeCopy(nodeClipboard.value)
    copyNodeToClipboard(duplicate)
    return true
  }

  function removeNode(nodeId: string) {
    nodes.value = nodes.value.filter(node => node.id !== nodeId)
    connections.value = connections.value.filter(conn => conn.fromNodeId !== nodeId && conn.toNodeId !== nodeId)
    if (selectedNodeId.value === nodeId) selectedNodeId.value = null
  }

  function clearCanvas() {
    nodes.value = []
    connections.value = []
    selectedNodeId.value = null
  }

  function importDocument(
    document: CanvasExportDocument,
    mode: 'append' | 'replace' = 'append',
  ): ImportedCanvasDocument {
    const append = mode === 'append'
    const imported = normalizeCanvasImport(document, {
      mode,
      existingNodeIds: nodes.value.map(node => node.id),
      createNodeId: type => createId(type),
      createConnectionId: () => createId('conn'),
      minNodeScale: MIN_NODE_SCALE,
      maxNodeScale: MAX_NODE_SCALE,
      minViewportZoom: MIN_VIEWPORT_ZOOM,
      maxViewportZoom: MAX_VIEWPORT_ZOOM,
    })
    const importedNodes = imported.nodes as CanvasNode[]
    const importedConnections = imported.connections as Connection[]

    if (append) {
      nodes.value = [...nodes.value, ...importedNodes]
      connections.value = [...connections.value, ...importedConnections]
    } else {
      nodes.value = importedNodes
      connections.value = importedConnections
    }

    selectedNodeId.value = importedNodes[0]?.id ?? null
    return {
      append,
      nodes: importedNodes,
      connections: importedConnections,
      viewport: imported.viewport,
    }
  }

  return {
    canvasId,
    nodes,
    connections,
    selectedNodeId,
    createId,
    createNode,
    nextImageTitle,
    getNodeById,
    insertNodeCopy,
    copyNodeToClipboard,
    copySelectedNode,
    pasteNodeFromClipboard,
    removeNode,
    clearCanvas,
    importDocument,
  }
}
