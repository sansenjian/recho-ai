<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type DirectiveBinding } from 'vue'
import { useImageGen } from '../composables/useImageGen'
import type { GeneratedImage, ImageGenRequest } from '../types/image'

type CanvasNodeType = 'text' | 'image' | 'generation'
type OutputHandle = 'text-out' | 'image-out' | 'generation-out'
type InputHandle = 'prompt-in' | 'reference-in' | 'image-in'
type NodeSize = ImageGenRequest['size']
type NodeAspectRatio = NonNullable<ImageGenRequest['aspectRatio']>
type NodeResolution = NonNullable<ImageGenRequest['resolution']>
type NodeQuality = NonNullable<ImageGenRequest['quality']>
type MentionField = 'text' | 'generation'
type WorkspaceMode = 'canvas' | 'gallery'

const props = defineProps<{
  workspaceMode?: WorkspaceMode
}>()

const emit = defineEmits<{
  sendToChat: [dataUrl: string]
  workspaceChange: [mode: WorkspaceMode]
}>()

interface CanvasNode {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  title: string
  content: string
  size: NodeSize
  aspectRatio: NodeAspectRatio
  resolution: NodeResolution
  quality: NodeQuality
  imageUrl?: string
  fileName?: string
  sourceImageId?: string
  sourcePrompt?: string
  scale?: number
  mentions?: string[]
  loading?: boolean
  status?: string | null
  error?: string | null
}

interface Connection {
  id: string
  fromNodeId: string
  fromHandle: OutputHandle
  toNodeId: string
  toHandle: InputHandle
  managedByMention?: boolean
}

interface DraftConnection {
  fromNodeId: string
  fromHandle: OutputHandle
  cursorX: number
  cursorY: number
}

interface DragState {
  nodeId: string
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

interface PanState {
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

interface ResizeState {
  nodeId: string
  corner: ResizeCorner
  startClientX: number
  startClientY: number
  startScale: number
  startX: number
  startY: number
}

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

interface MentionState {
  nodeId: string
  field: MentionField
  query: string
  start: number
  end: number
  activeIndex: number
}

interface ImageViewerState {
  imageUrl: string
  title: string
  caption: string
  zoom: number
}

const NODE_SIZE: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 270, height: 156 },
  image: { width: 232, height: 286 },
  generation: { width: 334, height: 656 },
}

const GENERATED_IMAGE_NODE_HEIGHT = 306
const PLANE_SIZE = { width: 3600, height: 2400 }
const MINI_MAP_VIEW = { width: 100, height: 54, padding: 5 }
const MENU_WIDTH = 176
const MENU_HEIGHT = 150
const MIN_NODE_SCALE = 0.72
const MAX_NODE_SCALE = 2.4
const GALLERY_PAGE_SIZE = 12
const GALLERY_AUTO_LOAD_PROGRESS = 0.5

const {
  isGenerating,
  isLoadingHistory,
  hasMoreHistory,
  error,
  generatedImages,
  generate,
  clearHistory,
  loadMoreHistory,
  resolveImageDetail,
} = useImageGen()

const viewportRef = ref<HTMLElement | null>(null)
const galleryStageRef = ref<HTMLElement | null>(null)
const nodes = ref<CanvasNode[]>([
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
  },
])
const connections = ref<Connection[]>([
  {
    id: 'conn_seed_text_generation',
    fromNodeId: 'node_text_seed',
    fromHandle: 'text-out',
    toNodeId: 'node_generation_seed',
    toHandle: 'prompt-in',
  },
])

const selectedNodeId = ref<string | null>('node_generation_seed')
const dragState = ref<DragState | null>(null)
const panState = ref<PanState | null>(null)
const resizeState = ref<ResizeState | null>(null)
const mentionState = ref<MentionState | null>(null)
const imageViewer = ref<ImageViewerState | null>(null)
const draftConnection = ref<DraftConnection | null>(null)
const viewport = ref({ x: -120, y: -40, zoom: 1 })
const activeWorkspace = ref<WorkspaceMode>('canvas')
const isGalleryAutoLoading = ref(false)
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  canvasX: 0,
  canvasY: 0,
})

let idSeed = Date.now()

watch(
  () => props.workspaceMode,
  (mode) => {
    if (mode && mode !== activeWorkspace.value) {
      selectWorkspace(mode, { emitChange: false })
    }
  },
  { immediate: true },
)

const planeStyle = computed(() => ({
  width: `${PLANE_SIZE.width}px`,
  height: `${PLANE_SIZE.height}px`,
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
}))

const miniMapLayout = computed(() => {
  const visibleNodes = nodes.value
  if (!visibleNodes.length) {
    return { nodes: [], connections: [] }
  }

  const boxes = visibleNodes.map((node) => {
    const size = getRenderedNodeSize(node)
    return {
      node,
      x: node.x,
      y: node.y,
      width: size.width,
      height: size.height,
    }
  })
  const minX = Math.min(...boxes.map(item => item.x))
  const minY = Math.min(...boxes.map(item => item.y))
  const maxX = Math.max(...boxes.map(item => item.x + item.width))
  const maxY = Math.max(...boxes.map(item => item.y + item.height))
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)
  const availableWidth = MINI_MAP_VIEW.width - MINI_MAP_VIEW.padding * 2
  const availableHeight = MINI_MAP_VIEW.height - MINI_MAP_VIEW.padding * 2
  const miniScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  const offsetX = (MINI_MAP_VIEW.width - contentWidth * miniScale) / 2
  const offsetY = (MINI_MAP_VIEW.height - contentHeight * miniScale) / 2
  const mapPoint = (x: number, y: number) => ({
    x: offsetX + (x - minX) * miniScale,
    y: offsetY + (y - minY) * miniScale,
  })

  return {
    nodes: boxes.map((item) => {
      const point = mapPoint(item.x, item.y)
      return {
        id: item.node.id,
        type: item.node.type,
        selected: selectedNodeId.value === item.node.id,
        x: point.x,
        y: point.y,
        width: Math.max(2.6, item.width * miniScale),
        height: Math.max(2.6, item.height * miniScale),
      }
    }),
    connections: connections.value.map((connection) => {
      const start = handlePoint(connection.fromNodeId, connection.fromHandle)
      const end = handlePoint(connection.toNodeId, connection.toHandle)
      const miniStart = mapPoint(start.x, start.y)
      const miniEnd = mapPoint(end.x, end.y)
      const distance = Math.max(8, Math.abs(miniEnd.x - miniStart.x) * 0.42)
      return {
        id: connection.id,
        d: `M ${miniStart.x} ${miniStart.y} C ${miniStart.x + distance} ${miniStart.y}, ${miniEnd.x - distance} ${miniEnd.y}, ${miniEnd.x} ${miniEnd.y}`,
      }
    }),
  }
})

const historyImages = computed(() => generatedImages.value.slice(0, 6))
const galleryVisibleCount = ref(GALLERY_PAGE_SIZE)
const galleryImages = computed(() => generatedImages.value.slice(0, galleryVisibleCount.value))
const canLoadMoreGallery = computed(() => galleryVisibleCount.value < generatedImages.value.length || hasMoreHistory.value)
const resolutionOptions: Array<{ value: NodeResolution; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]
const aspectRatioOptions: Array<{ value: NodeAspectRatio; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '1:1', label: '1:1' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
]
const qualityOptions: Array<{ value: NodeQuality; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]
const mentionOptions = computed(() => {
  const query = mentionState.value?.query.trim().toLowerCase() ?? ''
  return nodes.value
    .filter(node => node.type === 'image' && node.imageUrl)
    .filter(node => {
      if (!query) return true
      const label = `${node.title} ${node.content} ${node.fileName ?? ''}`.toLowerCase()
      return label.includes(query)
    })
    .slice(0, 8)
})

function createId(prefix: string) {
  idSeed += 1
  return `${prefix}_${idSeed}`
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
  const labels: Record<CanvasNodeType, string> = {
    text: '文本',
    image: '图片',
    generation: '图片生成',
  }

  const node: CanvasNode = {
    id: createId(type),
    type,
    x,
    y,
    title: labels[type],
    content: '',
    size: 'auto',
    aspectRatio: 'auto',
    resolution: 'auto',
    quality: 'auto',
    scale: 1,
    ...data,
  }

  nodes.value = [...nodes.value, node]
  selectedNodeId.value = node.id
  return node
}

function canvasPointFromClient(clientX: number, clientY: number) {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: (clientX - rect.left - viewport.value.x) / viewport.value.zoom,
    y: (clientY - rect.top - viewport.value.y) / viewport.value.zoom,
  }
}

function createNodeAtMenu(type: CanvasNodeType) {
  const node = createNode(type, contextMenu.value.canvasX, contextMenu.value.canvasY)
  contextMenu.value.visible = false
  if (type === 'image') {
    requestAnimationFrame(() => chooseImage(node.id))
  }
}

function createNodeNearCenter(type: CanvasNodeType) {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) return
  const point = canvasPointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2)
  const offset = nodes.value.length * 18
  const node = createNode(type, point.x - 120 + offset, point.y - 60 + offset)
  if (type === 'image') {
    requestAnimationFrame(() => chooseImage(node.id))
  }
}

function openContextMenu(event: MouseEvent) {
  const rect = viewportRef.value?.getBoundingClientRect()
  const point = canvasPointFromClient(event.clientX, event.clientY)
  contextMenu.value = {
    visible: true,
    x: Math.min(event.clientX - (rect?.left ?? 0), Math.max((rect?.width ?? MENU_WIDTH) - MENU_WIDTH - 12, 12)),
    y: Math.min(event.clientY - (rect?.top ?? 0), Math.max((rect?.height ?? MENU_HEIGHT) - MENU_HEIGHT - 12, 12)),
    canvasX: point.x,
    canvasY: point.y,
  }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId
  closeContextMenu()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getNodeScale(node: CanvasNode) {
  return node.scale ?? 1
}

function isGeneratedImageNode(node: CanvasNode) {
  return node.type === 'image' && Boolean(node.sourceImageId)
}

function getBaseNodeSize(node: CanvasNode) {
  const size = NODE_SIZE[node.type]
  if (isGeneratedImageNode(node)) {
    return { ...size, height: GENERATED_IMAGE_NODE_HEIGHT }
  }
  return size
}

function getRenderedNodeSize(node: CanvasNode) {
  const scale = getNodeScale(node)
  const size = getBaseNodeSize(node)
  return {
    width: size.width * scale,
    height: size.height * scale,
  }
}

function startNodeDrag(event: MouseEvent, node: CanvasNode) {
  if (event.button !== 0) return
  selectNode(node.id)
  dragState.value = {
    nodeId: node.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: node.x,
    startY: node.y,
  }
}

function startNodeResize(event: MouseEvent, node: CanvasNode, corner: ResizeCorner) {
  if (event.button !== 0) return
  selectNode(node.id)
  resizeState.value = {
    nodeId: node.id,
    corner,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScale: getNodeScale(node),
    startX: node.x,
    startY: node.y,
  }
}

function startPan(event: MouseEvent) {
  if (event.button !== 0 || event.target !== event.currentTarget) return
  selectedNodeId.value = null
  closeContextMenu()
  panState.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: viewport.value.x,
    startY: viewport.value.y,
  }
}

function handleWindowMouseMove(event: MouseEvent) {
  const resizing = resizeState.value
  if (resizing) {
    const node = nodes.value.find(item => item.id === resizing.nodeId)
    if (node) {
      const baseSize = getBaseNodeSize(node)
      const deltaX = (event.clientX - resizing.startClientX) / viewport.value.zoom
      const deltaY = (event.clientY - resizing.startClientY) / viewport.value.zoom
      const horizontalDirection = resizing.corner.endsWith('right') ? 1 : -1
      const verticalDirection = resizing.corner.startsWith('bottom') ? 1 : -1
      const widthDelta = (deltaX * horizontalDirection) / baseSize.width
      const heightDelta = (deltaY * verticalDirection) / baseSize.height
      const dominantDelta = Math.abs(widthDelta) >= Math.abs(heightDelta) ? widthDelta : heightDelta
      const nextScale = clamp(resizing.startScale + dominantDelta, MIN_NODE_SCALE, MAX_NODE_SCALE)

      node.scale = nextScale
      node.x = resizing.corner.endsWith('left')
        ? resizing.startX + baseSize.width * (resizing.startScale - nextScale)
        : resizing.startX
      node.y = resizing.corner.startsWith('top')
        ? resizing.startY + baseSize.height * (resizing.startScale - nextScale)
        : resizing.startY
    }
    return
  }

  const dragging = dragState.value
  if (dragging) {
    const node = nodes.value.find(item => item.id === dragging.nodeId)
    if (node) {
      node.x = dragging.startX + (event.clientX - dragging.startClientX) / viewport.value.zoom
      node.y = dragging.startY + (event.clientY - dragging.startClientY) / viewport.value.zoom
    }
  }

  const panning = panState.value
  if (panning) {
    viewport.value = {
      ...viewport.value,
      x: panning.startX + event.clientX - panning.startClientX,
      y: panning.startY + event.clientY - panning.startClientY,
    }
  }

  if (draftConnection.value) {
    const point = canvasPointFromClient(event.clientX, event.clientY)
    draftConnection.value = {
      ...draftConnection.value,
      cursorX: point.x,
      cursorY: point.y,
    }
  }
}

function handleWindowMouseUp() {
  dragState.value = null
  panState.value = null
  resizeState.value = null
  draftConnection.value = null
}

function handleWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const point = canvasPointFromClient(event.clientX, event.clientY)
  const nextZoom = Math.min(1.4, Math.max(0.68, viewport.value.zoom - event.deltaY * 0.0012))
  viewport.value = {
    x: event.clientX - (viewportRef.value?.getBoundingClientRect().left ?? 0) - point.x * nextZoom,
    y: event.clientY - (viewportRef.value?.getBoundingClientRect().top ?? 0) - point.y * nextZoom,
    zoom: nextZoom,
  }
}

function startConnection(event: MouseEvent, node: CanvasNode, handle: OutputHandle) {
  if (event.button !== 0) return
  selectNode(node.id)
  const point = canvasPointFromClient(event.clientX, event.clientY)
  draftConnection.value = {
    fromNodeId: node.id,
    fromHandle: handle,
    cursorX: point.x,
    cursorY: point.y,
  }
}

function finishConnection(event: MouseEvent, targetNode: CanvasNode, targetHandle: InputHandle) {
  const draft = draftConnection.value
  if (!draft) return
  event.preventDefault()
  event.stopPropagation()

  if (isValidConnection(draft.fromNodeId, draft.fromHandle, targetNode.id, targetHandle)) {
    const isDuplicate = connections.value.some(conn => (
      conn.fromNodeId === draft.fromNodeId &&
      conn.fromHandle === draft.fromHandle &&
      conn.toNodeId === targetNode.id &&
      conn.toHandle === targetHandle
    ))

    if (!isDuplicate) {
      connections.value = [
        ...connections.value,
        {
          id: createId('conn'),
          fromNodeId: draft.fromNodeId,
          fromHandle: draft.fromHandle,
          toNodeId: targetNode.id,
          toHandle: targetHandle,
        },
      ]
      if (targetNode.type === 'generation' && targetHandle === 'prompt-in') {
        syncMentionConnectionsForGeneration(targetNode)
      }
    }
  }

  draftConnection.value = null
}

function isValidConnection(fromNodeId: string, fromHandle: OutputHandle, toNodeId: string, toHandle: InputHandle) {
  if (fromNodeId === toNodeId) return false
  const source = nodes.value.find(node => node.id === fromNodeId)
  const target = nodes.value.find(node => node.id === toNodeId)
  if (!source || !target) return false
  if (source.type === 'text' && fromHandle === 'text-out') {
    return target.type === 'generation' && toHandle === 'prompt-in'
  }
  if (source.type === 'image' && fromHandle === 'image-out') {
    return target.type === 'generation' && toHandle === 'reference-in'
  }
  if (source.type === 'generation' && fromHandle === 'generation-out') {
    return target.type === 'image' && toHandle === 'image-in'
  }
  return false
}

function incomingConnections(nodeId: string, handle?: InputHandle) {
  return connections.value.filter(conn => (
    conn.toNodeId === nodeId &&
    (!handle || conn.toHandle === handle)
  ))
}

function getNodeById(nodeId: string) {
  return nodes.value.find(node => node.id === nodeId)
}

function connectedTextNodes(node: CanvasNode) {
  return incomingConnections(node.id, 'prompt-in')
    .map(conn => getNodeById(conn.fromNodeId))
    .filter((item): item is CanvasNode => Boolean(item && item.type === 'text'))
}

function connectedImageNodes(node: CanvasNode) {
  return incomingConnections(node.id, 'reference-in')
    .map(conn => getNodeById(conn.fromNodeId))
    .filter((item): item is CanvasNode => Boolean(item && item.type === 'image'))
}

function imageNodesByMention(text: string) {
  const names = new Set<string>()
  const mentionPattern = /@([\u4e00-\u9fa5A-Za-z0-9_-]+)/g
  for (const match of text.matchAll(mentionPattern)) {
    names.add(match[1])
  }
  return nodes.value.filter(node => (
    node.type === 'image' &&
    Boolean(node.imageUrl) &&
    names.has(node.title)
  ))
}

function imageNodesByIds(ids: string[] = []) {
  const idSet = new Set(ids)
  return nodes.value.filter(node => (
    node.type === 'image' &&
    Boolean(node.imageUrl) &&
    idSet.has(node.id)
  ))
}

function imageNodeForRichToken(id?: string, title?: string) {
  if (id) return imageNodesByIds([id])[0] ?? null
  if (!title) return null
  return nodes.value.find(node => (
    node.type === 'image' &&
    Boolean(node.imageUrl) &&
    node.title === title
  )) ?? null
}

function imageTokenIds(text: string) {
  const ids: string[] = []
  const tokenPattern = /\{\{image:([^}]+)\}\}/g
  for (const match of text.matchAll(tokenPattern)) {
    ids.push(match[1])
  }
  return ids
}

function mentionedImageNodesForNode(node: CanvasNode) {
  return uniqueImageNodes([
    ...imageNodesByIds(node.mentions),
    ...imageNodesByIds(imageTokenIds(node.content)),
    ...imageNodesByMention(node.content),
  ])
}

function promptMentionedImageNodesForGeneration(node: CanvasNode) {
  if (hasPromptLink(node)) {
    return uniqueImageNodes(connectedTextNodes(node).flatMap(item => mentionedImageNodesForNode(item)))
  }
  return mentionedImageNodesForNode(node)
}

function uniqueImageNodes(items: CanvasNode[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function promptTextWithImageLabels(text: string) {
  return text
    .replace(/\{\{image:([^}]+)\}\}/g, (_match, id: string) => imageNodeForRichToken(id)?.title ?? '')
    .replace(/@([\u4e00-\u9fa5A-Za-z0-9_-]+)/g, (_match, title: string) => imageNodeForRichToken(undefined, title)?.title ?? title)
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function referencedImageNodes(node: CanvasNode) {
  return uniqueImageNodes([
    ...connectedImageNodes(node).filter(item => item.imageUrl),
    ...promptMentionedImageNodesForGeneration(node),
  ])
}

function syncMentionConnectionsForGeneration(node: CanvasNode) {
  if (node.type !== 'generation') return
  const mentionedIds = new Set(promptMentionedImageNodesForGeneration(node).map(item => item.id))

  connections.value = connections.value.filter(conn => (
    conn.toNodeId !== node.id ||
    conn.toHandle !== 'reference-in' ||
    !conn.managedByMention ||
    mentionedIds.has(conn.fromNodeId)
  ))

  const nextConnections = [...connections.value]
  for (const imageNodeId of mentionedIds) {
    const exists = nextConnections.some(conn => (
      conn.fromNodeId === imageNodeId &&
      conn.fromHandle === 'image-out' &&
      conn.toNodeId === node.id &&
      conn.toHandle === 'reference-in'
    ))
    if (!exists) {
      nextConnections.push({
        id: createId('conn'),
        fromNodeId: imageNodeId,
        fromHandle: 'image-out',
        toNodeId: node.id,
        toHandle: 'reference-in',
        managedByMention: true,
      })
    }
  }
  connections.value = nextConnections
}

function syncMentionConnectionsForTextNode(node: CanvasNode) {
  if (node.type !== 'text') return
  for (const conn of connections.value) {
    if (conn.fromNodeId !== node.id || conn.toHandle !== 'prompt-in') continue
    const target = getNodeById(conn.toNodeId)
    if (target?.type === 'generation') {
      syncMentionConnectionsForGeneration(target)
    }
  }
}

function nodeStyle(node: CanvasNode) {
  const scale = getNodeScale(node)
  const size = getBaseNodeSize(node)
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    transform: `translate(${node.x}px, ${node.y}px) scale(${scale})`,
    transformOrigin: '0 0',
  }
}

function handlePoint(nodeId: string, handle: OutputHandle | InputHandle) {
  const node = getNodeById(nodeId)
  if (!node) return { x: 0, y: 0 }
  const size = getRenderedNodeSize(node)
  const scale = getNodeScale(node)

  if (handle === 'text-out') return { x: node.x + size.width, y: node.y + 78 * scale }
  if (handle === 'image-in') return { x: node.x, y: node.y + size.height / 2 }
  if (handle === 'image-out') return { x: node.x + size.width, y: node.y + size.height / 2 }
  if (handle === 'prompt-in') return { x: node.x, y: node.y + 90 * scale }
  if (handle === 'reference-in') return { x: node.x, y: node.y + 174 * scale }
  return { x: node.x + size.width, y: node.y + 188 * scale }
}

function connectionPath(connection: Connection) {
  const start = handlePoint(connection.fromNodeId, connection.fromHandle)
  const end = handlePoint(connection.toNodeId, connection.toHandle)
  return curvePath(start.x, start.y, end.x, end.y)
}

const draftPath = computed(() => {
  const draft = draftConnection.value
  if (!draft) return ''
  const start = handlePoint(draft.fromNodeId, draft.fromHandle)
  return curvePath(start.x, start.y, draft.cursorX, draft.cursorY)
})

function curvePath(startX: number, startY: number, endX: number, endY: number) {
  const distance = Math.max(80, Math.abs(endX - startX) * 0.48)
  return `M ${startX} ${startY} C ${startX + distance} ${startY}, ${endX - distance} ${endY}, ${endX} ${endY}`
}

function removeNode(nodeId: string) {
  nodes.value = nodes.value.filter(node => node.id !== nodeId)
  connections.value = connections.value.filter(conn => conn.fromNodeId !== nodeId && conn.toNodeId !== nodeId)
  if (selectedNodeId.value === nodeId) selectedNodeId.value = null
}

function chooseImage(nodeId: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const node = getNodeById(nodeId)
      if (!node || typeof reader.result !== 'string') return
      node.imageUrl = reader.result
      node.fileName = file.name
      if (!/^图片\d+$/.test(node.title.trim())) {
        node.title = nextImageTitle(node.id)
      }
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

async function useHistoryImage(image: GeneratedImage) {
  const detail = await resolveImageDetail(image)
  if (!detail.dataUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }

  activeWorkspace.value = 'canvas'
  const rect = viewportRef.value?.getBoundingClientRect()
  const point = rect
    ? canvasPointFromClient(rect.left + rect.width * 0.56, rect.top + rect.height * 0.58)
    : { x: 720, y: 420 }

  createNode('image', point.x, point.y, {
    title: nextImageTitle(),
    content: '',
    imageUrl: detail.dataUrl,
    sourceImageId: detail.id,
    sourcePrompt: detail.prompt,
    fileName: detail.size,
  })
}

function galleryPrompt(image: GeneratedImage) {
  return image.prompt || '无提示词'
}

function galleryReferences(image: GeneratedImage) {
  return image.references?.filter(reference => reference.dataUrl || reference.thumbnailUrl) ?? []
}

function displayImageUrl(image: GeneratedImage) {
  return image.thumbnailUrl || image.dataUrl || ''
}

function displayReferenceUrl(reference: NonNullable<GeneratedImage['references']>[number]) {
  return reference.thumbnailUrl || reference.dataUrl || ''
}

async function handleLoadMoreGallery() {
  if (!canLoadMoreGallery.value || isGalleryAutoLoading.value || isLoadingHistory.value) return

  isGalleryAutoLoading.value = true
  try {
    const localCount = generatedImages.value.length
    if (galleryVisibleCount.value < localCount) {
      galleryVisibleCount.value = Math.min(galleryVisibleCount.value + GALLERY_PAGE_SIZE, localCount)
      return
    }

    if (!hasMoreHistory.value) return

    await loadMoreHistory()
    const updatedCount = generatedImages.value.length
    if (updatedCount > galleryVisibleCount.value) {
      galleryVisibleCount.value = Math.min(galleryVisibleCount.value + GALLERY_PAGE_SIZE, updatedCount)
    }
  } finally {
    isGalleryAutoLoading.value = false
  }
}

function handleGalleryScroll() {
  const stage = galleryStageRef.value
  if (!stage || activeWorkspace.value !== 'gallery') return

  const scrollableHeight = stage.scrollHeight - stage.clientHeight
  if (scrollableHeight <= 0) return

  const scrollProgress = stage.scrollTop / scrollableHeight
  if (scrollProgress >= GALLERY_AUTO_LOAD_PROGRESS) {
    void handleLoadMoreGallery()
  }
}

function galleryFileName(image: GeneratedImage) {
  const promptName = galleryPrompt(image)
    .slice(0, 28)
    .replace(/[^a-zA-Z0-9一-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
  return `${promptName || image.id || 'recho_image'}.png`
}

async function downloadGeneratedImage(image: GeneratedImage) {
  const detail = await resolveImageDetail(image)
  if (!detail.dataUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }

  const a = document.createElement('a')
  a.href = detail.dataUrl
  a.download = galleryFileName(detail)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

async function sendHistoryImageToChat(image: GeneratedImage) {
  const detail = await resolveImageDetail(image)
  if (!detail.dataUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }
  emit('sendToChat', detail.dataUrl)
}

function selectWorkspace(mode: WorkspaceMode, options: { emitChange?: boolean } = {}) {
  activeWorkspace.value = mode
  closeContextMenu()
  if (options.emitChange !== false) {
    emit('workspaceChange', mode)
  }
}

function getConnectedPrompt(node: CanvasNode) {
  return connectedTextNodes(node)
    .map(item => item.content.trim())
    .filter(Boolean)
    .join('\n')
}

function hasPromptLink(node: CanvasNode) {
  return incomingConnections(node.id, 'prompt-in').length > 0
}

function getGenerationPromptValue(node: CanvasNode) {
  return hasPromptLink(node) ? getConnectedPrompt(node) : node.content
}

function serializeRichEditor(root: HTMLElement) {
  let value = ''
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-token')) {
      const id = node.dataset.mentionId
      if (id) value += `{{image:${id}}}`
      return
    }
    node.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  const serialized = value.replace(/\u00a0/g, ' ')
  root.dataset.serialized = serialized
  return serialized
}

function textBeforeCaret(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return ''
  const activeRange = selection.getRangeAt(0)
  if (!root.contains(activeRange.startContainer)) return ''

  let value = ''
  const appendEditableText = (node: Node) => {
    if (node instanceof HTMLElement && node.classList.contains('mention-token')) return
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? ''
      return
    }
    node.childNodes.forEach(appendEditableText)
  }
  const visit = (node: Node): boolean => {
    if (node instanceof HTMLElement && node.classList.contains('mention-token')) return false
    if (node === activeRange.startContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        value += (node.textContent ?? '').slice(0, activeRange.startOffset)
      } else {
        Array.from(node.childNodes)
          .slice(0, activeRange.startOffset)
          .forEach(appendEditableText)
      }
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? ''
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true
    }
    return false
  }

  visit(root)
  return value
}

function setRichEditorSelection(root: HTMLElement, start: number, end: number) {
  const range = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(textNode) {
      const parent = textNode.parentElement
      return parent?.closest('.mention-token') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  let offset = 0
  let current = walker.nextNode()
  let startSet = false

  while (current) {
    const text = current.textContent ?? ''
    const nextOffset = offset + text.length
    if (!startSet && start <= nextOffset) {
      range.setStart(current, Math.max(0, start - offset))
      startSet = true
    }
    if (end <= nextOffset) {
      range.setEnd(current, Math.max(0, end - offset))
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return true
    }
    offset = nextOffset
    current = walker.nextNode()
  }

  range.selectNodeContents(root)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return startSet
}

function createMentionTokenElement(imageNode: CanvasNode) {
  const token = document.createElement('span')
  token.className = 'mention-token'
  token.contentEditable = 'false'
  token.dataset.mentionId = imageNode.id
  Object.assign(token.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    maxWidth: '132px',
    minHeight: '26px',
    margin: '0 2px',
    padding: '2px 6px 2px 3px',
    border: '1px solid #dbe3ee',
    borderRadius: '7px',
    background: '#fff',
    color: 'var(--text-primary)',
    fontSize: '12px',
    fontWeight: '900',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  })

  if (imageNode.imageUrl) {
    const img = document.createElement('img')
    img.src = imageNode.imageUrl
    img.alt = imageNode.title
    Object.assign(img.style, {
      width: '20px',
      height: '20px',
      borderRadius: '5px',
      objectFit: 'cover',
      flex: '0 0 auto',
    })
    token.appendChild(img)
  }

  const label = document.createElement('span')
  label.textContent = imageNode.title
  Object.assign(label.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  })
  token.appendChild(label)
  return token
}

function renderRichEditorContent(root: HTMLElement, value = '') {
  const fragment = document.createDocumentFragment()
  const tokenPattern = /\{\{image:([^}]+)\}\}|@([\u4e00-\u9fa5A-Za-z0-9_-]+)/g
  let cursor = 0

  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? cursor
    if (index > cursor) {
      fragment.append(document.createTextNode(value.slice(cursor, index)))
    }

    const imageNode = imageNodeForRichToken(match[1], match[2])
    fragment.append(imageNode
      ? createMentionTokenElement(imageNode)
      : document.createTextNode(match[0]))
    cursor = index + match[0].length
  }

  if (cursor < value.length) {
    fragment.append(document.createTextNode(value.slice(cursor)))
  }

  root.replaceChildren(fragment)
  root.dataset.serialized = value
}

const vRichContent = {
  mounted(el: HTMLElement, binding: DirectiveBinding<string>) {
    renderRichEditorContent(el, binding.value ?? '')
  },
  updated(el: HTMLElement, binding: DirectiveBinding<string>) {
    const value = binding.value ?? ''
    if (document.activeElement === el) return
    if (el.dataset.serialized === value) return
    renderRichEditorContent(el, value)
  },
}

function updateRichEditorContent(event: Event, node: CanvasNode, field: MentionField) {
  const el = event.currentTarget as HTMLElement
  node.content = serializeRichEditor(el)
  updateMentionStateFromEditor(el, node, field)
  if (field === 'text') {
    syncMentionConnectionsForTextNode(node)
  } else {
    syncMentionConnectionsForGeneration(node)
  }
}

function updateMentionStateFromEditor(root: HTMLElement, node: CanvasNode, field: MentionField) {
  const beforeCaret = textBeforeCaret(root)
  const caret = beforeCaret.length
  const atIndex = beforeCaret.lastIndexOf('@')

  if (atIndex < 0) {
    closeMentionIndex(node.id, field)
    return
  }

  const query = beforeCaret.slice(atIndex + 1)
  if (/[\s\n\r]/.test(query)) {
    closeMentionIndex(node.id, field)
    return
  }

  const previous = mentionState.value
  const activeIndex = previous &&
    previous.nodeId === node.id &&
    previous.field === field &&
    previous.query === query &&
    previous.start === atIndex &&
    previous.end === caret
    ? previous.activeIndex
    : 0

  mentionState.value = {
    nodeId: node.id,
    field,
    query,
    start: atIndex,
    end: caret,
    activeIndex,
  }
}

function closeMentionIndex(nodeId?: string, field?: MentionField) {
  if (!mentionState.value) return
  if (nodeId && mentionState.value.nodeId !== nodeId) return
  if (field && mentionState.value.field !== field) return
  mentionState.value = null
}

function isMentionIndexOpen(node: CanvasNode, field: MentionField) {
  return mentionState.value?.nodeId === node.id &&
    mentionState.value.field === field &&
    mentionOptions.value.length > 0
}

function insertMention(node: CanvasNode, imageNode: CanvasNode) {
  const state = mentionState.value
  if (!state || state.nodeId !== node.id) return
  const editor = document.activeElement instanceof HTMLElement &&
    document.activeElement.classList.contains('rich-editor')
    ? document.activeElement
    : null

  if (editor && setRichEditorSelection(editor, state.start, state.end)) {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (range) {
      range.deleteContents()
      const token = createMentionTokenElement(imageNode)
      const spacer = document.createTextNode(' ')
      range.insertNode(token)
      range.setStartAfter(token)
      range.collapse(true)
      range.insertNode(spacer)
      range.setStartAfter(spacer)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      node.content = serializeRichEditor(editor)
    }
  } else {
    const value = node.content
    const before = value.slice(0, state.start).replace(/[ \t]*$/, ' ')
    const after = value.slice(state.end).replace(/^[ \t]*/, '')
    node.content = `${before}{{image:${imageNode.id}}} ${after}`.trimStart()
  }

  mentionState.value = null

  if (state.field === 'text') {
    syncMentionConnectionsForTextNode(node)
  } else {
    syncMentionConnectionsForGeneration(node)
  }
}

function handleMentionKeydown(event: KeyboardEvent, node: CanvasNode, field: MentionField) {
  if (!isMentionIndexOpen(node, field)) return
  const options = mentionOptions.value
  const state = mentionState.value
  if (!state) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    mentionState.value = { ...state, activeIndex: (state.activeIndex + 1) % options.length }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    mentionState.value = { ...state, activeIndex: (state.activeIndex - 1 + options.length) % options.length }
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    insertMention(node, options[state.activeIndex] ?? options[0])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    mentionState.value = null
  }
}

function buildPrompt(node: CanvasNode) {
  syncMentionConnectionsForGeneration(node)
  const promptText = hasPromptLink(node) ? getConnectedPrompt(node) : node.content.trim()
  const references = referencedImageNodes(node)
  const promptParts = [promptTextWithImageLabels(promptText)].filter(Boolean)
  const referenceGuide = references.length
    ? [
      `已上传 ${references.length} 张真实参考图，请严格使用这些参考图，不要只根据文字重新想象。`,
      '提示词中的 图片1、图片2 等名称与下方参考图顺序一一对应。',
      '当提示词要求参考风格时，只迁移该参考图的画风、色彩、质感；当提示词要求主角、角色、姿态或内容时，要保留对应参考图的主体特征。',
    ].join('\n')
    : ''

  const referenceParts = references
    .map((item, index) => {
      const label = item.content.trim()
      return `${item.title}: 第 ${index + 1} 张参考图${label ? `，${label}` : ''}`
    })
    .filter(Boolean)

  return [referenceGuide, ...promptParts, ...referenceParts].filter(Boolean).join('\n\n')
}

function buildReferences(node: CanvasNode) {
  return referencedImageNodes(node)
    .filter((item): item is CanvasNode & { imageUrl: string } => Boolean(item.imageUrl))
    .map(item => ({
      id: item.id,
      title: item.title,
      dataUrl: item.imageUrl,
      content: item.content.trim() || undefined,
      fileName: item.fileName,
    }))
}

function imageAltText(node: CanvasNode) {
  return node.content.trim() || node.sourcePrompt || node.title
}

function imageOutputMeta(node: CanvasNode) {
  return node.fileName || 'PNG'
}

async function generateFromNode(node: CanvasNode) {
  if (isGenerating.value || node.loading) return
  const prompt = buildPrompt(node)
  const references = buildReferences(node)
  if (!prompt.trim()) {
    node.error = '请连接文本节点或填写提示词。'
    return
  }

  node.loading = true
  node.status = references.length
    ? `正在上传 ${references.length} 张参考图并生成...`
    : '正在生成图片...'
  node.error = null
  const result = await generate(prompt, {
    aspectRatio: node.aspectRatio,
    resolution: node.resolution,
    quality: node.quality,
    references,
  })
  node.loading = false
  node.status = null

  if (!result) {
    node.error = error.value || '生成失败'
    return
  }

  const outputNode = createNode('image', node.x + NODE_SIZE.generation.width + 132, node.y + 46, {
    title: nextImageTitle(),
    content: '',
    imageUrl: result.dataUrl,
    sourceImageId: result.id,
    sourcePrompt: result.prompt,
    fileName: result.size,
  })

  connections.value = [
    ...connections.value,
    {
      id: createId('conn'),
      fromNodeId: node.id,
      fromHandle: 'generation-out',
      toNodeId: outputNode.id,
      toHandle: 'image-in',
    },
  ]
}

function createContinuation(node: CanvasNode) {
  const imageSize = getRenderedNodeSize(node)
  const generationNode = createNode('generation', node.x + imageSize.width + 132, node.y - 18, {
    title: '继续生成',
  })

  connections.value = [
    ...connections.value,
    {
      id: createId('conn'),
      fromNodeId: node.id,
      fromHandle: 'image-out',
      toNodeId: generationNode.id,
      toHandle: 'reference-in',
    },
  ]
}

function handleDownload(node: CanvasNode) {
  if (!node.imageUrl) return
  downloadImageUrl(node.imageUrl, node.content || node.title)
}

function openImageViewer(node: CanvasNode) {
  if (!node.imageUrl) return
  imageViewer.value = {
    imageUrl: node.imageUrl,
    title: node.title,
    caption: imageAltText(node),
    zoom: 1,
  }
}

function closeImageViewer() {
  imageViewer.value = null
}

function downloadImageUrl(imageUrl: string, title: string) {
  const a = document.createElement('a')
  a.href = imageUrl
  a.download = `${title.slice(0, 30).replace(/[^a-zA-Z0-9一-鿿]/g, '_') || 'recho_image'}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function zoomImageViewer(step: number) {
  if (!imageViewer.value) return
  imageViewer.value.zoom = clamp(imageViewer.value.zoom + step, 0.35, 4)
}

function resetImageViewerZoom() {
  if (!imageViewer.value) return
  imageViewer.value.zoom = 1
}

function handleImageViewerWheel(event: WheelEvent) {
  if (!imageViewer.value) return
  event.preventDefault()
  zoomImageViewer(event.deltaY > 0 ? -0.12 : 0.12)
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (!imageViewer.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeImageViewer()
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomImageViewer(0.12)
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    zoomImageViewer(-0.12)
  } else if (event.key === '0') {
    event.preventDefault()
    resetImageViewerZoom()
  }
}

function fitView() {
  viewport.value = { x: -120, y: -40, zoom: 1 }
}

function clearCanvas() {
  nodes.value = []
  connections.value = []
  selectedNodeId.value = null
}

function hasIncoming(node: CanvasNode, handle: InputHandle) {
  return incomingConnections(node.id, handle).length > 0
}

onMounted(() => {
  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', handleWindowKeydown)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <div class="image-canvas">
    <aside class="canvas-sidebar">
      <div class="workspace-switch">
        <button
          class="workspace-tab"
          type="button"
          :class="{ active: activeWorkspace === 'canvas' }"
          @click="selectWorkspace('canvas')"
        >
          工作台
        </button>
        <button
          class="workspace-tab"
          type="button"
          :class="{ active: activeWorkspace === 'gallery' }"
          @click="selectWorkspace('gallery')"
        >
          作品广场
        </button>
      </div>

      <div class="mode-switch">
        <span>Imagio</span>
        <button type="button">画布</button>
      </div>

      <div class="mini-map" aria-hidden="true">
        <div class="mini-map-frame">
          <svg
            class="mini-map-svg"
            :viewBox="`0 0 ${MINI_MAP_VIEW.width} ${MINI_MAP_VIEW.height}`"
            preserveAspectRatio="none"
          >
            <path
              v-for="connection in miniMapLayout.connections"
              :key="connection.id"
              class="mini-connection"
              :d="connection.d"
            />
            <rect
              v-for="node in miniMapLayout.nodes"
              :key="node.id"
              class="mini-node"
              :class="[`mini-node-${node.type}`, { selected: node.selected }]"
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
              rx="1.6"
            />
          </svg>
        </div>
      </div>

      <div class="quick-create">
        <button class="create-button" type="button" title="创建文本节点" @click="createNodeNearCenter('text')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
            <path d="M4 6h16" />
            <path d="M10 6v12" />
            <path d="M14 6v12" />
          </svg>
        </button>
        <button class="create-button" type="button" title="创建图片节点" @click="createNodeNearCenter('image')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </button>
        <button class="create-button primary" type="button" title="创建生图节点" @click="createNodeNearCenter('generation')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
            <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
          </svg>
        </button>
      </div>

      <div class="history-panel">
        <div class="side-title">
          <span>生成记录</span>
          <button v-if="generatedImages.length" type="button" disabled @click="clearHistory">清空</button>
        </div>
        <button
          v-for="img in historyImages"
          :key="img.id"
          class="history-item"
          type="button"
          @click="useHistoryImage(img)"
        >
          <img :src="displayImageUrl(img)" :alt="img.prompt" loading="lazy">
          <span>{{ img.prompt || img.size }}</span>
        </button>
        <div v-if="!historyImages.length" class="history-empty">暂无记录</div>
      </div>
    </aside>

    <section v-if="activeWorkspace === 'canvas'" class="canvas-stage">
      <div class="stage-actions">
        <button class="tool-button active" type="button" title="选择">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="m5 3 14 8-6 2-3 6L5 3Z" />
          </svg>
        </button>
        <button class="tool-button" type="button" title="复位视图" @click="fitView">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v6h6" />
          </svg>
        </button>
        <button class="tool-button danger" type="button" title="清空画布" @click="clearCanvas">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="m6 6 1 15h10l1-15" />
          </svg>
        </button>
        <span class="zoom-pill">{{ Math.round(viewport.zoom * 100) }}%</span>
      </div>

      <div
        ref="viewportRef"
        class="canvas-viewport"
        @contextmenu.prevent="openContextMenu"
        @mousedown="startPan"
        @wheel="handleWheel"
      >
        <div class="graph-plane" :style="planeStyle" @mousedown="startPan">
          <svg class="connections" :viewBox="`0 0 ${PLANE_SIZE.width} ${PLANE_SIZE.height}`">
            <path
              v-for="connection in connections"
              :key="connection.id"
              class="connection-path"
              :d="connectionPath(connection)"
            />
            <path v-if="draftPath" class="connection-path draft" :d="draftPath" />
          </svg>

          <article
            v-for="node in nodes"
            :key="node.id"
            class="canvas-node"
            :class="[`node-${node.type}`, { selected: selectedNodeId === node.id }]"
            :style="nodeStyle(node)"
            @mousedown.stop="selectNode(node.id)"
          >
            <header class="node-header" @mousedown.stop="startNodeDrag($event, node)">
              <span class="node-icon" aria-hidden="true">
                <svg v-if="node.type === 'text'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15">
                  <path d="M4 6h16" />
                  <path d="M10 6v12" />
                  <path d="M14 6v12" />
                </svg>
                <svg v-else-if="node.type === 'image'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                  <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
                </svg>
              </span>
              <span class="node-title">{{ node.title }}</span>
              <button class="node-remove" type="button" title="删除节点" @click.stop="removeNode(node.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </header>

            <template v-if="node.type === 'text'">
              <div
                v-rich-content="node.content"
                class="node-textarea rich-editor"
                contenteditable="true"
                data-placeholder="输入文本内容，可用 @ 引用图片..."
                @input="updateRichEditorContent($event, node, 'text')"
                @keydown="handleMentionKeydown($event, node, 'text')"
                @keyup="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'text')"
                @mouseup="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'text')"
                @focus="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'text')"
                @mousedown.stop
              />
              <div
                v-if="isMentionIndexOpen(node, 'text')"
                class="mention-index text-mention-index"
                @mousedown.stop.prevent
              >
                <button
                  v-for="(imageNode, index) in mentionOptions"
                  :key="imageNode.id"
                  type="button"
                  :class="{ active: mentionState?.activeIndex === index }"
                  @mousedown.prevent="insertMention(node, imageNode)"
                >
                  <img v-if="imageNode.imageUrl" :src="imageNode.imageUrl" :alt="imageNode.title">
                  <span>{{ imageNode.title }}</span>
                  <small>{{ imageNode.content || imageNode.fileName || '图片参考' }}</small>
                </button>
              </div>
              <span
                class="node-handle output"
                title="连接到生图节点"
                @mousedown.stop.prevent="startConnection($event, node, 'text-out')"
              />
            </template>

            <template v-else-if="node.type === 'image'">
              <span
                class="node-handle input"
                title="接收生成结果"
                :class="{ connected: hasIncoming(node, 'image-in') }"
                @mouseup.stop.prevent="finishConnection($event, node, 'image-in')"
              />
              <div class="image-preview" :class="{ empty: !node.imageUrl, generated: isGeneratedImageNode(node) }">
                <img
                  v-if="node.imageUrl"
                  :src="node.imageUrl"
                  :alt="imageAltText(node)"
                  loading="lazy"
                  @dblclick.stop="openImageViewer(node)"
                >
                <button v-else class="pick-image" type="button" @click.stop="chooseImage(node.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="26" height="26">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M12 8v8" />
                    <path d="M8 12h8" />
                  </svg>
                </button>
                <button
                  v-if="node.imageUrl"
                  class="zoom-image"
                  type="button"
                  title="放大查看"
                  @click.stop="openImageViewer(node)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="m16.2 16.2 4.3 4.3" />
                    <path d="M11 8.8v4.4" />
                    <path d="M8.8 11h4.4" />
                  </svg>
                </button>
                <button v-if="node.imageUrl" class="replace-image" type="button" title="替换图片" @click.stop="chooseImage(node.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <path d="M21 12a9 9 0 1 1-3-6.7" />
                    <path d="M21 4v6h-6" />
                  </svg>
                </button>
              </div>
              <div v-if="isGeneratedImageNode(node)" class="image-output-panel">
                <div class="image-output-meta">
                  <span class="image-output-badge">生成结果</span>
                  <span>{{ imageOutputMeta(node) }}</span>
                </div>
                <input
                  v-model="node.content"
                  class="image-output-note"
                  type="text"
                  placeholder="添加参考说明..."
                  @mousedown.stop
                >
              </div>
              <textarea
                v-else
                v-model="node.content"
                class="image-caption"
                placeholder="图片参考说明..."
                @mousedown.stop
              />
              <div class="image-node-actions">
                <button type="button" :disabled="!node.imageUrl" @click.stop="createContinuation(node)">继续</button>
                <button type="button" :disabled="!node.imageUrl" @click.stop="handleDownload(node)">下载</button>
                <button type="button" :disabled="!node.imageUrl" @click.stop="emit('sendToChat', node.imageUrl!)">对话</button>
              </div>
              <span
                class="node-handle output"
                title="作为参考图连接"
                @mousedown.stop.prevent="startConnection($event, node, 'image-out')"
              />
            </template>

            <template v-else>
              <span
                class="node-handle input prompt"
                title="连接文本"
                :class="{ connected: hasIncoming(node, 'prompt-in') }"
                @mouseup.stop.prevent="finishConnection($event, node, 'prompt-in')"
              />
              <span
                class="node-handle input reference"
                title="连接参考图"
                :class="{ connected: hasIncoming(node, 'reference-in') }"
                @mouseup.stop.prevent="finishConnection($event, node, 'reference-in')"
              />
              <span
                class="node-handle output generation"
                title="输出图片"
                @mousedown.stop.prevent="startConnection($event, node, 'generation-out')"
              />

              <div class="generation-body">
                <div class="generation-scroll">
                  <div
                    v-if="hasPromptLink(node)"
                    v-rich-content="getGenerationPromptValue(node)"
                    class="generation-prompt rich-editor readonly"
                  />
                  <div
                    v-else
                    v-rich-content="node.content"
                    class="generation-prompt rich-editor"
                    contenteditable="true"
                    data-placeholder="输入文本内容，可用 @ 引用图片。"
                    @input="updateRichEditorContent($event, node, 'generation')"
                    @keydown="handleMentionKeydown($event, node, 'generation')"
                    @keyup="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'generation')"
                    @mouseup="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'generation')"
                    @focus="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'generation')"
                    @mousedown.stop
                  />
                  <div
                    v-if="isMentionIndexOpen(node, 'generation')"
                    class="mention-index generation-mention-index"
                    @mousedown.stop.prevent
                  >
                    <button
                      v-for="(imageNode, index) in mentionOptions"
                      :key="imageNode.id"
                      type="button"
                      :class="{ active: mentionState?.activeIndex === index }"
                      @mousedown.prevent="insertMention(node, imageNode)"
                    >
                      <img v-if="imageNode.imageUrl" :src="imageNode.imageUrl" :alt="imageNode.title">
                      <span>{{ imageNode.title }}</span>
                      <small>{{ imageNode.content || imageNode.fileName || '图片参考' }}</small>
                    </button>
                  </div>

                  <div class="linked-block reference-block">
                    <div class="linked-row">
                      <span class="linked-label">参考图</span>
                      <span class="linked-count">{{ referencedImageNodes(node).length }} 张</span>
                    </div>
                    <div class="reference-list">
                      <div v-for="imageNode in referencedImageNodes(node)" :key="imageNode.id" class="reference-chip">
                        <img v-if="imageNode.imageUrl" :src="imageNode.imageUrl" :alt="imageNode.content || imageNode.title">
                        <span>{{ imageNode.title }} · {{ imageNode.content || imageNode.fileName || '参考图' }}</span>
                      </div>
                      <p v-if="!referencedImageNodes(node).length">暂无参考图，可输入 @图片1 引用</p>
                    </div>
                  </div>

                  <div class="control-group">
                    <span class="control-label">分辨率</span>
                    <div class="segmented">
                      <button
                        v-for="option in resolutionOptions"
                        :key="option.value"
                        type="button"
                        :class="{ active: node.resolution === option.value }"
                        @click.stop="node.resolution = option.value"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                    <span class="control-hint">Auto 会交给模型选择；1K/2K/4K 会按比例映射输出尺寸。</span>
                  </div>

                  <div class="control-group">
                    <span class="control-label">尺寸 / 比例</span>
                    <div class="segmented aspect-grid">
                      <button
                        v-for="option in aspectRatioOptions"
                        :key="option.value"
                        type="button"
                        :class="{ active: node.aspectRatio === option.value }"
                        @click.stop="node.aspectRatio = option.value"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>

                  <div class="control-group">
                    <span class="control-label">质量</span>
                    <div class="segmented">
                      <button
                        v-for="option in qualityOptions"
                        :key="option.value"
                        type="button"
                        :class="{ active: node.quality === option.value }"
                        @click.stop="node.quality = option.value"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                    <span class="control-hint">Low 适合快速草图，Medium/High 适合最终资产。</span>
                  </div>
                </div>

                <div class="generation-footer">
                  <p v-if="node.loading" class="node-status">{{ node.status || '生成中...' }}</p>
                  <p v-else-if="isGenerating" class="node-status">已有图片正在生成，请稍等...</p>
                  <p v-if="node.error" class="node-error">{{ node.error }}</p>

                  <button
                    class="generate-button"
                    type="button"
                    :disabled="isGenerating || node.loading"
                    @click.stop="generateFromNode(node)"
                  >
                    <span v-if="node.loading || isGenerating" class="spinner" />
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                      <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
                    </svg>
                    {{ node.loading || isGenerating ? '生成中...' : '生成' }}
                  </button>
                </div>
              </div>
            </template>

            <span
              class="resize-corner top-left"
              @mousedown.stop.prevent="startNodeResize($event, node, 'top-left')"
              @dblclick.stop.prevent="node.scale = 1"
            />
            <span
              class="resize-corner top-right"
              @mousedown.stop.prevent="startNodeResize($event, node, 'top-right')"
              @dblclick.stop.prevent="node.scale = 1"
            />
            <span
              class="resize-corner bottom-left"
              @mousedown.stop.prevent="startNodeResize($event, node, 'bottom-left')"
              @dblclick.stop.prevent="node.scale = 1"
            />
            <span
              class="resize-corner bottom-right"
              @mousedown.stop.prevent="startNodeResize($event, node, 'bottom-right')"
              @dblclick.stop.prevent="node.scale = 1"
            />
          </article>
        </div>

        <div
          v-if="contextMenu.visible"
          class="context-menu"
          :style="{ transform: `translate(${contextMenu.x}px, ${contextMenu.y}px)` }"
          @click.stop
        >
          <button type="button" @click="createNodeAtMenu('text')">
            <span class="menu-icon">T</span>
            <span>文本节点</span>
          </button>
          <button type="button" @click="createNodeAtMenu('image')">
            <span class="menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </span>
            <span>图片节点</span>
          </button>
          <button type="button" @click="createNodeAtMenu('generation')">
            <span class="menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
              </svg>
            </span>
            <span>生图节点</span>
          </button>
        </div>
      </div>

      <div class="bottom-toolbar">
        <button class="tool-button active" type="button" title="选择">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="m5 3 14 8-6 2-3 6L5 3Z" />
          </svg>
        </button>
        <button class="tool-button" type="button" title="移动画布">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M18 11V7a2 2 0 0 0-4 0v4" />
            <path d="M14 10V6a2 2 0 0 0-4 0v8" />
            <path d="M10 12.5 8.5 11A2.1 2.1 0 0 0 5 12.5l4.1 5.4A5 5 0 0 0 13.1 20H16a4 4 0 0 0 4-4v-5a2 2 0 0 0-4 0v1" />
          </svg>
        </button>
        <span class="toolbar-divider" />
        <button class="tool-button" type="button" title="缩小" @click="viewport.zoom = Math.max(0.68, viewport.zoom - 0.08)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
            <circle cx="11" cy="11" r="7" />
            <path d="M8 11h6" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
        <input v-model.number="viewport.zoom" class="zoom-range" type="range" min="0.68" max="1.4" step="0.02" aria-label="缩放">
        <button class="tool-button" type="button" title="放大" @click="viewport.zoom = Math.min(1.4, viewport.zoom + 0.08)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
            <circle cx="11" cy="11" r="7" />
            <path d="M8 11h6" />
            <path d="M11 8v6" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
        <span class="zoom-dot">{{ connections.length }}</span>
      </div>

      <div v-if="error" class="global-error">{{ error }}</div>
    </section>

    <section
      v-else
      ref="galleryStageRef"
      class="gallery-stage"
      @scroll.passive="handleGalleryScroll"
    >
      <div class="gallery-header">
        <div>
          <span class="gallery-eyebrow">作品广场</span>
          <h2>历史生成</h2>
        </div>
        <button v-if="galleryImages.length" type="button" disabled @click="clearHistory">清空历史</button>
      </div>

      <div v-if="galleryImages.length" class="gallery-grid">
        <article v-for="image in galleryImages" :key="image.id" class="gallery-card">
          <div class="gallery-image-wrap">
            <img :src="displayImageUrl(image)" :alt="galleryPrompt(image)" loading="lazy">
          </div>
          <div class="gallery-card-body">
            <div class="gallery-meta-row">
              <span>{{ image.size || 'auto' }}</span>
              <span>{{ image.quality || 'auto' }}</span>
              <span>{{ new Date(image.timestamp).toLocaleString() }}</span>
            </div>
            <section class="gallery-section">
              <h3>提示词</h3>
              <p>{{ galleryPrompt(image) }}</p>
            </section>
            <section class="gallery-section">
              <div class="gallery-section-title">
                <h3>参考图</h3>
                <span>{{ galleryReferences(image).length }} 张</span>
              </div>
              <div v-if="galleryReferences(image).length" class="gallery-reference-list">
                <div
                  v-for="reference in galleryReferences(image)"
                  :key="reference.id || reference.title"
                  class="gallery-reference"
                >
                  <img :src="displayReferenceUrl(reference)" :alt="reference.title">
                  <span>{{ reference.title || reference.fileName || '参考图' }}</span>
                </div>
              </div>
              <p v-else class="gallery-empty-text">没有使用参考图</p>
            </section>
            <div class="gallery-actions">
              <button type="button" @click="useHistoryImage(image)">放入画布</button>
              <button type="button" @click="downloadGeneratedImage(image)">下载</button>
              <button type="button" @click="sendHistoryImageToChat(image)">对话</button>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="gallery-empty">
        <strong>还没有历史作品</strong>
        <span>生成图片后，这里会显示提示词、参考图和生成结果。</span>
      </div>

      <div v-if="galleryImages.length && (isGalleryAutoLoading || isLoadingHistory)" class="gallery-scroll-status">
        加载中...
      </div>

      <div v-if="error" class="global-error">{{ error }}</div>
    </section>

    <Teleport to="body">
      <div
        v-if="imageViewer"
        class="image-viewer-overlay"
        @mousedown.self="closeImageViewer"
      >
        <div class="image-viewer-shell" @mousedown.stop>
          <header class="image-viewer-header">
            <div class="image-viewer-meta">
              <strong>{{ imageViewer.title }}</strong>
              <span>{{ imageViewer.caption }}</span>
            </div>
            <div class="image-viewer-controls">
              <button type="button" title="缩小" @click="zoomImageViewer(-0.12)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M8 11h6" />
                  <path d="m16 16 4 4" />
                </svg>
              </button>
              <button type="button" title="复位" @click="resetImageViewerZoom">1:1</button>
              <span class="image-viewer-zoom">{{ Math.round((imageViewer.zoom || 1) * 100) }}%</span>
              <button type="button" title="放大" @click="zoomImageViewer(0.12)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M8 11h6" />
                  <path d="M11 8v6" />
                  <path d="m16 16 4 4" />
                </svg>
              </button>
              <button type="button" title="下载" @click="downloadImageUrl(imageViewer.imageUrl, imageViewer.title)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 19h14" />
                </svg>
              </button>
              <button type="button" class="image-viewer-close" title="关闭" @click="closeImageViewer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </header>
          <div class="image-viewer-stage" @wheel.prevent="handleImageViewerWheel">
            <img
              :src="imageViewer.imageUrl"
              :alt="imageViewer.caption"
              :style="{
                width: `${Math.round(imageViewer.zoom * 100)}%`,
                height: `${Math.round(imageViewer.zoom * 100)}%`,
              }"
              draggable="false"
            >
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.image-canvas {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #f6f8fb;
}

.canvas-sidebar {
  width: 286px;
  flex-shrink: 0;
  padding: 14px 12px;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, #f9fafb 0%, #ffffff 100%);
  overflow-y: auto;
}

.workspace-switch {
  display: inline-flex;
  gap: 6px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  box-shadow: var(--shadow-sm);
}

.workspace-tab {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.workspace-tab.active {
  background: #0b0f14;
  color: #fff;
}

.mode-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 16px 4px 42px;
  padding: 5px;
  border-radius: 12px;
  background: #f1f3f5;
  color: #73777f;
  font-size: 15px;
  font-weight: 800;
}

.mode-switch span,
.mode-switch button {
  flex: 1;
  min-height: 34px;
  border: 0;
  border-radius: 9px;
  text-align: center;
}

.mode-switch span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mode-switch button {
  background: #fff;
  color: #0f172a;
  font-weight: 800;
  box-shadow: var(--shadow-sm);
}

.mini-map {
  height: 156px;
  padding: 10px;
  border: 1px solid #1f2937;
  border-radius: 8px;
  background:
    linear-gradient(#edf2f7 1px, transparent 1px),
    linear-gradient(90deg, #edf2f7 1px, transparent 1px),
    #fff;
  background-size: 18px 18px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08);
}

.mini-map-frame {
  position: relative;
  height: 100%;
  border: 2px dashed #111827;
  border-radius: 6px;
  overflow: hidden;
}

.mini-map-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.mini-connection {
  fill: none;
  stroke: #94a3b8;
  stroke-width: 0.7;
  stroke-linecap: round;
}

.mini-node {
  fill: #fff;
  stroke: #cbd5e1;
  stroke-width: 0.55;
}

.mini-node-text {
  fill: #f8fafc;
}

.mini-node-image {
  fill: #eef6ff;
}

.mini-node-generation {
  fill: #fff7ed;
}

.mini-node.selected {
  stroke: #111827;
  stroke-width: 0.9;
}

.quick-create {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 34px 0 28px;
}

.create-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.create-button:hover {
  border-color: var(--border);
  background: var(--hover-bg);
  color: var(--text-primary);
}

.create-button.primary {
  background: #111827;
  color: #fff;
}

.history-panel {
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
}

.side-title button {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.side-title button:disabled,
.gallery-header button:disabled {
  opacity: 0.42;
  cursor: default;
}

.history-item {
  display: grid;
  grid-template-columns: 38px 1fr;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 8px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}

.history-item:hover {
  border-color: var(--border-strong);
  background: var(--surface-soft);
}

.history-item img {
  width: 38px;
  height: 38px;
  border-radius: 6px;
  object-fit: cover;
}

.history-item span {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-empty {
  padding: 18px 0;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.canvas-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.gallery-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 28px;
  overflow-y: auto;
  background:
    linear-gradient(#e3e9f1 1px, transparent 1px),
    linear-gradient(90deg, #e3e9f1 1px, transparent 1px),
    #fbfdff;
  background-size: 28px 28px;
}

.gallery-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.gallery-eyebrow {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.gallery-header h2 {
  margin: 3px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  letter-spacing: 0;
}

.gallery-header button,
.gallery-actions button {
  min-height: 34px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.gallery-header button {
  padding: 0 12px;
}

.gallery-header button:disabled {
  color: var(--text-muted);
  pointer-events: none;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.gallery-card {
  display: grid;
  grid-template-rows: 220px auto;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
}

.gallery-image-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    #f8fafc;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  background-size: 18px 18px;
}

.gallery-image-wrap img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.gallery-card-body {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.gallery-meta-row {
  display: flex;
  min-width: 0;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.gallery-meta-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-section {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.gallery-section h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.gallery-section p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.48;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.gallery-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.gallery-section-title span,
.gallery-empty-text {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.gallery-reference-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.gallery-reference {
  display: grid;
  width: 64px;
  flex: 0 0 auto;
  gap: 4px;
}

.gallery-reference img {
  width: 64px;
  height: 64px;
  border: 1px solid var(--border);
  border-radius: 7px;
  object-fit: cover;
}

.gallery-reference span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
}

.gallery-actions button:hover {
  border-color: var(--border-strong);
  background: var(--surface-soft);
}

.gallery-scroll-status {
  padding: 20px 0 4px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.gallery-empty {
  display: grid;
  place-items: center;
  min-height: 320px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-muted);
  text-align: center;
}

.gallery-empty strong {
  color: var(--text-primary);
  font-size: 18px;
}

.gallery-empty span {
  margin-top: 8px;
  font-size: 13px;
}

.canvas-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: default;
  background:
    linear-gradient(#e3e9f1 1px, transparent 1px),
    linear-gradient(90deg, #e3e9f1 1px, transparent 1px),
    linear-gradient(#f1f5f9 1px, transparent 1px),
    linear-gradient(90deg, #f1f5f9 1px, transparent 1px),
    #fbfdff;
  background-size: 28px 28px, 28px 28px, 140px 140px, 140px 140px;
}

.graph-plane {
  position: absolute;
  inset: 0 auto auto 0;
  transform-origin: 0 0;
}

.connections {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.connection-path {
  fill: none;
  stroke: #7a8492;
  stroke-width: 3;
  stroke-linecap: round;
  filter: drop-shadow(0 1px 1px rgba(15, 23, 42, 0.12));
}

.connection-path.draft {
  stroke: var(--accent);
  stroke-dasharray: 8 7;
}

.canvas-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.09);
  color: var(--text-primary);
}

.canvas-node.selected {
  border-color: #111827;
  box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.08), 0 22px 56px rgba(15, 23, 42, 0.12);
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
  background: #fff;
  cursor: grab;
  user-select: none;
}

.node-header:active {
  cursor: grabbing;
}

.node-icon {
  display: inline-flex;
  color: var(--text-primary);
}

.node-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
}

.canvas-node:hover .node-remove {
  opacity: 1;
}

.node-remove:hover {
  background: var(--hover-bg);
  color: var(--danger);
}

.node-textarea,
.generation-prompt,
.image-caption {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  resize: none;
  outline: none;
}

.node-textarea {
  flex: 1;
  padding: 12px;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.55;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.rich-editor:empty::before {
  content: attr(data-placeholder);
  color: #a8b1bf;
  pointer-events: none;
}

.rich-editor.readonly {
  cursor: default;
}

.mention-token {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 132px;
  min-height: 26px;
  margin: 0 2px;
  padding: 2px 6px 2px 3px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
  vertical-align: middle;
  white-space: nowrap;
}

.mention-token img {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  object-fit: cover;
}

.mention-token span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-textarea::placeholder,
.generation-prompt::placeholder,
.image-caption::placeholder {
  color: #a8b1bf;
}

.image-preview {
  position: relative;
  height: 136px;
  margin: 10px 10px 0;
  border-radius: 7px;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    #f8fafc;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  overflow: hidden;
}

.image-preview.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-strong);
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-preview.generated {
  height: 158px;
}

.pick-image,
.replace-image {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
}

.pick-image {
  width: 46px;
  height: 46px;
}

.replace-image {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 30px;
  height: 30px;
}

.zoom-image {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  color: var(--text-secondary);
  cursor: pointer;
}

.zoom-image:hover {
  border-color: var(--border-strong);
  background: #fff;
  color: var(--text-primary);
}

.image-caption {
  height: 48px;
  padding: 8px 10px 2px;
  font-size: 12px;
  line-height: 1.35;
}

.image-output-panel {
  display: grid;
  gap: 6px;
  padding: 8px 10px 4px;
}

.image-output-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.image-output-meta span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.image-output-badge {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(14, 165, 233, 0.1);
  color: #0369a1;
  font-size: 10px;
  font-weight: 900;
}

.image-output-note {
  width: 100%;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 8px;
  background: #fff;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.image-output-note:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.12);
}

.image-output-note::placeholder {
  color: #a8b1bf;
}

.image-node-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 6px 10px 10px;
}

.image-node-actions button {
  min-height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.image-node-actions button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

.image-node-actions button:disabled {
  opacity: 0.46;
  cursor: not-allowed;
}

.image-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(10, 15, 25, 0.78);
  backdrop-filter: blur(10px);
}

.image-viewer-shell {
  display: grid;
  grid-template-rows: auto 1fr;
  width: min(1120px, calc(100vw - 48px));
  max-width: 100%;
  height: min(88vh, 920px);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  background: rgba(10, 15, 25, 0.96);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.38);
  overflow: hidden;
}

.image-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
}

.image-viewer-meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.image-viewer-meta strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer-meta span {
  overflow: hidden;
  color: rgba(226, 232, 240, 0.78);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.image-viewer-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
}

.image-viewer-controls button:hover {
  background: rgba(255, 255, 255, 0.16);
}

.image-viewer-close {
  color: #fff;
}

.image-viewer-zoom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 62px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  font-weight: 800;
}

.image-viewer-stage {
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: auto;
  padding: 24px;
}

.image-viewer-stage img {
  min-width: 0;
  min-height: 0;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.resize-corner {
  position: absolute;
  z-index: 8;
  width: 18px;
  height: 18px;
  background: transparent;
}

.resize-corner.top-left {
  left: -6px;
  top: -6px;
  cursor: nwse-resize;
}

.resize-corner.top-right {
  right: -6px;
  top: -6px;
  cursor: nesw-resize;
}

.resize-corner.bottom-left {
  left: -6px;
  bottom: -6px;
  cursor: nesw-resize;
}

.resize-corner.bottom-right {
  right: -6px;
  bottom: -6px;
  cursor: nwse-resize;
}

.node-handle {
  position: absolute;
  z-index: 5;
  width: 12px;
  height: 12px;
  border: 2px solid #111827;
  border-radius: 999px;
  background: #111827;
  cursor: crosshair;
}

.node-handle.input {
  left: -7px;
  top: 122px;
  background: #fff;
}

.node-handle.output {
  right: -7px;
  top: 72px;
}

.node-image .node-handle.output {
  top: calc(50% - 6px);
}

.node-image .node-handle.input {
  top: calc(50% - 6px);
}

.node-handle.prompt {
  top: 84px;
}

.node-handle.reference {
  top: 168px;
}

.node-handle.generation {
  top: 182px;
}

.node-handle.connected {
  background: var(--accent);
  border-color: var(--accent);
}

.generation-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 10px 12px 12px;
}

.generation-scroll {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 9px;
  overflow-y: auto;
  padding-right: 2px;
}

.generation-footer {
  display: grid;
  flex: 0 0 auto;
  gap: 6px;
  padding-top: 8px;
  background: rgba(255, 255, 255, 0.96);
}

.mention-index {
  position: absolute;
  z-index: 24;
  display: grid;
  gap: 3px;
  max-height: 184px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  overflow-y: auto;
}

.text-mention-index {
  left: 12px;
  right: 12px;
  top: 92px;
}

.generation-mention-index {
  left: 12px;
  right: 12px;
  top: 86px;
}

.mention-index button {
  display: grid;
  grid-template-columns: 28px 56px 1fr;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.mention-index button.active,
.mention-index button:hover {
  background: var(--hover-bg);
}

.mention-index img {
  width: 28px;
  height: 28px;
  border-radius: 5px;
  object-fit: cover;
}

.mention-index span {
  font-size: 12px;
  font-weight: 900;
}

.mention-index small {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linked-block {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fbfcfe;
  padding: 8px;
}

.linked-block p {
  display: -webkit-box;
  min-height: 39px;
  max-height: 58px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.linked-label,
.control-label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 800;
}

.generation-prompt {
  flex: 0 0 116px;
  height: 116px;
  min-height: 74px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  font-size: 12px;
  line-height: 1.45;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.linked-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.linked-count {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.reference-block {
  flex: 0 0 auto;
  min-height: 76px;
}

.reference-list {
  display: grid;
  gap: 6px;
  max-height: 58px;
  overflow-y: auto;
}

.reference-list p {
  min-height: auto;
  color: var(--text-muted);
  font-size: 12px;
}

.reference-chip {
  display: grid;
  grid-template-columns: 24px 1fr;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.reference-chip img {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  object-fit: cover;
}

.reference-chip span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.control-group {
  display: grid;
  gap: 6px;
}

.control-hint {
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.segmented.aspect-grid {
  grid-template-columns: repeat(3, 1fr);
}

.segmented button {
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.segmented button.active {
  border-color: #111827;
  color: #111827;
  box-shadow: inset 0 0 0 1px #111827;
}

.node-status,
.node-error {
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
}

.node-status {
  color: var(--text-muted);
}

.node-error {
  color: var(--danger);
}

.generate-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  border: 0;
  border-radius: 7px;
  background: #050505;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.generate-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.34);
  border-top-color: #fff;
  border-radius: 999px;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.context-menu {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 30;
  width: 176px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
  backdrop-filter: blur(10px);
}

.context-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 40px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  text-align: left;
}

.context-menu button:hover {
  background: var(--hover-bg);
}

.menu-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.stage-actions,
.bottom-toolbar {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(12px);
}

.stage-actions {
  right: 18px;
  top: 18px;
}

.bottom-toolbar {
  left: 22px;
  bottom: 18px;
}

.tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tool-button:hover {
  border-color: var(--border);
  background: var(--hover-bg);
  color: var(--text-primary);
}

.tool-button.active {
  background: #050505;
  color: #fff;
}

.tool-button.danger:hover {
  color: var(--danger);
}

.toolbar-divider {
  width: 1px;
  height: 22px;
  background: var(--border);
}

.zoom-pill,
.zoom-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 24px;
  padding: 0 7px;
  border-radius: 999px;
  background: #111827;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

.zoom-dot {
  min-width: 26px;
  width: 26px;
  padding: 0;
}

.zoom-range {
  width: 92px;
  accent-color: #111827;
}

.global-error {
  position: absolute;
  left: 50%;
  bottom: 22px;
  z-index: 24;
  max-width: min(560px, calc(100% - 64px));
  padding: 10px 14px;
  border: 1px solid rgba(220, 38, 38, 0.18);
  border-radius: 8px;
  background: #fff;
  color: var(--danger);
  font-size: 12px;
  font-weight: 700;
  box-shadow: var(--shadow-md);
  transform: translateX(-50%);
}

@media (max-width: 980px) {
  .canvas-sidebar {
    width: 220px;
  }
}

@media (max-width: 760px) {
  .image-canvas {
    flex-direction: column;
  }

  .canvas-sidebar {
    display: none;
  }

  .canvas-stage {
    min-height: 0;
  }

  .stage-actions {
    right: 10px;
    top: 10px;
  }

  .bottom-toolbar {
    left: 10px;
    right: 10px;
    bottom: 10px;
    justify-content: center;
  }
}
</style>
