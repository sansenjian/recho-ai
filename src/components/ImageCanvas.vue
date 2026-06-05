<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type DirectiveBinding } from 'vue'
import { useImageGen, type ImageHistoryScope } from '../composables/useImageGen'
import type { GeneratedImage, ImageGenRequest } from '../types/image'

type CanvasNodeType = 'text' | 'image' | 'generation'
type OutputHandle = 'text-out' | 'image-out' | 'generation-out'
type InputHandle = 'prompt-in' | 'reference-in' | 'image-in'
type CanvasHandle = OutputHandle | InputHandle
type HandleRole = 'input' | 'output'
type NodeSize = ImageGenRequest['size']
type NodeAspectRatio = NonNullable<ImageGenRequest['aspectRatio']>
type NodeResolution = NonNullable<ImageGenRequest['resolution']>
type NodeQuality = NonNullable<ImageGenRequest['quality']>
type MentionField = 'text' | 'generation'
type WorkspaceMode = 'canvas' | 'gallery'
type GalleryFilter = 'mine' | 'references' | 'latest'

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
  sourceHistoryScope?: ImageHistoryScope
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
  nodeId: string
  handle: CanvasHandle
  role: HandleRole
  cursorX: number
  cursorY: number
  startClientX: number
  startClientY: number
}

interface PendingMenuConnection {
  nodeId: string
  handle: CanvasHandle
  role: HandleRole
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  canvasX: number
  canvasY: number
  pendingConnection: PendingMenuConnection | null
  targetNodeId: string | null
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

interface GalleryParam {
  label: string
  value: string
}

const NODE_SIZE: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 270, height: 156 },
  image: { width: 232, height: 326 },
  generation: { width: 334, height: 700 },
}

const GENERATED_IMAGE_NODE_HEIGHT = 346
const PLANE_SIZE = { width: 3600, height: 2400 }
const MINI_MAP_VIEW = { width: 100, height: 54, padding: 5 }
const MENU_WIDTH = 176
const MENU_HEIGHT = 150
const MIN_NODE_SCALE = 0.72
const MAX_NODE_SCALE = 2.4
const MIN_VIEWPORT_ZOOM = 0.42
const MAX_VIEWPORT_ZOOM = 1.4
const GALLERY_PAGE_SIZE = 12
const GALLERY_AUTO_LOAD_PROGRESS = 0.5
const REFERENCE_IMAGE_MAX_EDGE = 2048
const REFERENCE_IMAGE_WEBP_QUALITY = 0.86
const TEXT_NODE_CONTENT_SCALE_FACTOR = 0.5
const MINI_MAP_WORLD_PADDING = 96

const {
  isGenerating,
  isLoadingHistory,
  hasMoreHistory,
  isLoadingGallery,
  hasMoreGallery,
  galleryLoaded,
  error,
  generatedImages,
  galleryImages: publicGalleryImages,
  generate,
  clearHistory,
  loadMoreHistory,
  ensureGalleryLoaded,
  loadMoreGalleryHistory,
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
const nodeClipboard = ref<CanvasNode | null>(null)
const dragState = ref<DragState | null>(null)
const panState = ref<PanState | null>(null)
const resizeState = ref<ResizeState | null>(null)
const mentionState = ref<MentionState | null>(null)
const imageViewer = ref<ImageViewerState | null>(null)
const galleryDetail = ref<GeneratedImage | null>(null)
const galleryDetailScope = ref<ImageHistoryScope>('mine')
const draftConnection = ref<DraftConnection | null>(null)
const viewport = ref({ x: -120, y: -40, zoom: 1 })
const viewportZoomLabel = computed(() => `${Math.round(viewport.value.zoom * 100)}%`)
const activeWorkspace = ref<WorkspaceMode>('canvas')
const isGalleryAutoLoading = ref(false)
const galleryQuery = ref('')
const galleryFilter = ref<GalleryFilter>('mine')
const isPublicGalleryFilter = computed(() => galleryFilter.value !== 'mine')
const contextMenu = ref<ContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  canvasX: 0,
  canvasY: 0,
  pendingConnection: null as PendingMenuConnection | null,
  targetNodeId: null,
})

let idSeed = Date.now()
let suppressNextWindowClick = false
let suppressClickTimer: number | null = null

watch(
  () => props.workspaceMode,
  (mode) => {
    if (mode && mode !== activeWorkspace.value) {
      selectWorkspace(mode, { emitChange: false })
    }
  },
  { immediate: true },
)

watch([galleryQuery, galleryFilter], () => {
  galleryVisibleCount.value = GALLERY_PAGE_SIZE
  if (isPublicGalleryFilter.value) {
    void ensureGalleryLoaded()
  }
  void nextTick(() => {
    galleryStageRef.value?.scrollTo({ top: 0 })
  })
})

const planeStyle = computed(() => ({
  width: `${PLANE_SIZE.width}px`,
  height: `${PLANE_SIZE.height}px`,
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
}))

const miniMapLayout = computed(() => {
  const visibleNodes = nodes.value
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
  const viewportRect = viewportRef.value?.getBoundingClientRect()
  const viewportBox = viewportRect
    ? {
      x: -viewport.value.x / viewport.value.zoom,
      y: -viewport.value.y / viewport.value.zoom,
      width: viewportRect.width / viewport.value.zoom,
      height: viewportRect.height / viewport.value.zoom,
    }
    : null
  const worldBoxes = [
    ...boxes,
    ...(viewportBox ? [viewportBox] : []),
  ]
  if (!worldBoxes.length) {
    return { nodes: [], connections: [], viewport: null }
  }

  const rawMinX = Math.min(...worldBoxes.map(item => item.x))
  const rawMinY = Math.min(...worldBoxes.map(item => item.y))
  const rawMaxX = Math.max(...worldBoxes.map(item => item.x + item.width))
  const rawMaxY = Math.max(...worldBoxes.map(item => item.y + item.height))
  const contentWidth = Math.max(1, rawMaxX - rawMinX + MINI_MAP_WORLD_PADDING * 2)
  const contentHeight = Math.max(1, rawMaxY - rawMinY + MINI_MAP_WORLD_PADDING * 2)
  const minX = rawMinX - MINI_MAP_WORLD_PADDING
  const minY = rawMinY - MINI_MAP_WORLD_PADDING
  const availableWidth = MINI_MAP_VIEW.width - MINI_MAP_VIEW.padding * 2
  const availableHeight = MINI_MAP_VIEW.height - MINI_MAP_VIEW.padding * 2
  const miniScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  const offsetX = (MINI_MAP_VIEW.width - contentWidth * miniScale) / 2
  const offsetY = (MINI_MAP_VIEW.height - contentHeight * miniScale) / 2
  const mapPoint = (x: number, y: number) => ({
    x: offsetX + (x - minX) * miniScale,
    y: offsetY + (y - minY) * miniScale,
  })
  const mapBox = (box: { x: number; y: number; width: number; height: number }) => {
    const point = mapPoint(box.x, box.y)
    return {
      x: point.x,
      y: point.y,
      width: Math.max(3, box.width * miniScale),
      height: Math.max(3, box.height * miniScale),
    }
  }

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
    viewport: viewportBox ? mapBox(viewportBox) : null,
  }
})

const historyImages = computed(() => generatedImages.value.slice(0, 6))
const galleryActionScope = computed<ImageHistoryScope>(() => isPublicGalleryFilter.value ? 'public' : 'mine')
const gallerySourceImages = computed(() => isPublicGalleryFilter.value ? publicGalleryImages.value : generatedImages.value)
const galleryFilterOptions: Array<{ value: GalleryFilter; label: string }> = [
  { value: 'mine', label: '我的' },
  { value: 'references', label: '参考图' },
  { value: 'latest', label: '最新' },
]
const galleryVisibleCount = ref(GALLERY_PAGE_SIZE)
const galleryHasFilter = computed(() => galleryFilter.value !== 'mine' || Boolean(galleryQuery.value.trim()))
const filteredGalleryImages = computed(() => {
  const query = galleryQuery.value.trim().toLowerCase()
  return gallerySourceImages.value.filter((image) => {
    if (galleryFilter.value === 'references' && !galleryReferenceCount(image)) return false
    if (!query) return true

    const searchable = [
      galleryPrompt(image),
      image.size,
      image.aspectRatio,
      image.resolution,
      image.quality,
      ...galleryReferences(image).map(reference => `${reference.title} ${reference.fileName ?? ''}`),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return searchable.includes(query)
  })
})
const visibleGalleryImages = computed(() => filteredGalleryImages.value.slice(0, galleryVisibleCount.value))
const canLoadMoreGallery = computed(() => (
  galleryVisibleCount.value < filteredGalleryImages.value.length ||
  (isPublicGalleryFilter.value ? hasMoreGallery.value : hasMoreHistory.value)
))
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
const contextMenuNode = computed(() => (
  contextMenu.value.targetNodeId ? getNodeById(contextMenu.value.targetNodeId) ?? null : null
))

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

function visibleCanvasCenterClientPoint() {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) return null

  const isMobile = rect.width <= 760
  const topInset = isMobile ? 142 : 0
  const bottomInset = isMobile ? 112 : 0
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + topInset + (rect.height - topInset - bottomInset) / 2,
  }
}

function nodePositionNearVisibleCenter(type: CanvasNodeType) {
  const center = visibleCanvasCenterClientPoint()
  if (!center) return null
  const point = canvasPointFromClient(center.x, center.y)
  const size = NODE_SIZE[type]
  const offset = nodes.value.length * 18
  return {
    x: point.x - size.width / 2 + offset,
    y: point.y - Math.min(size.height / 2, 180) + offset,
  }
}

function createNodeAtMenu(type: CanvasNodeType) {
  const pendingConnection = contextMenu.value.pendingConnection
  const node = createNode(type, contextMenu.value.canvasX, contextMenu.value.canvasY)
  closeContextMenu()
  if (pendingConnection) {
    connectPendingMenuConnection(pendingConnection, node)
  }
  if (type === 'image') {
    requestAnimationFrame(() => chooseImage(node.id))
  }
}

function createNodeNearCenter(type: CanvasNodeType) {
  const position = nodePositionNearVisibleCenter(type)
  if (!position) return
  const node = createNode(type, position.x, position.y)
  if (type === 'image') {
    requestAnimationFrame(() => chooseImage(node.id))
  }
}

function openContextMenuAtClient(
  clientX: number,
  clientY: number,
  pendingConnection: PendingMenuConnection | null = null,
  targetNodeId: string | null = null,
) {
  const rect = viewportRef.value?.getBoundingClientRect()
  const point = canvasPointFromClient(clientX, clientY)
  const maxX = Math.max((rect?.width ?? MENU_WIDTH) - MENU_WIDTH - 12, 12)
  const maxY = Math.max((rect?.height ?? MENU_HEIGHT) - MENU_HEIGHT - 12, 12)
  contextMenu.value = {
    visible: true,
    x: clamp(clientX - (rect?.left ?? 0), 12, maxX),
    y: clamp(clientY - (rect?.top ?? 0), 12, maxY),
    canvasX: point.x,
    canvasY: point.y,
    pendingConnection,
    targetNodeId,
  }
}

function openContextMenu(event: MouseEvent) {
  openContextMenuAtClient(event.clientX, event.clientY)
}

function openNodeContextMenu(event: MouseEvent, node: CanvasNode) {
  selectedNodeId.value = node.id
  openContextMenuAtClient(event.clientX, event.clientY, null, node.id)
}

function closeContextMenu() {
  contextMenu.value.visible = false
  contextMenu.value.pendingConnection = null
  contextMenu.value.targetNodeId = null
}

function suppressNextClickClose() {
  suppressNextWindowClick = true
  if (suppressClickTimer !== null) {
    window.clearTimeout(suppressClickTimer)
  }
  suppressClickTimer = window.setTimeout(() => {
    suppressNextWindowClick = false
    suppressClickTimer = null
  }, 120)
}

function handleWindowClick() {
  if (suppressNextWindowClick) {
    suppressNextWindowClick = false
    if (suppressClickTimer !== null) {
      window.clearTimeout(suppressClickTimer)
      suppressClickTimer = null
    }
    return
  }
  closeContextMenu()
}

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId
  closeContextMenu()
}

function duplicatedNodeTitle(node: CanvasNode) {
  if (node.type === 'image' && /^图片\d+$/.test(node.title.trim())) {
    return nextImageTitle()
  }

  const title = node.title.trim() || '节点'
  return `${title} 副本`.slice(0, 48)
}

function cleanNodeCopy(node: CanvasNode): CanvasNode {
  return {
    ...node,
    mentions: node.mentions ? [...node.mentions] : undefined,
    loading: false,
    status: null,
    error: null,
  }
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
  closeContextMenu()
  return true
}

function pasteNodeFromClipboard() {
  if (!nodeClipboard.value) return false
  const duplicate = insertNodeCopy(nodeClipboard.value)
  copyNodeToClipboard(duplicate)
  closeContextMenu()
  return true
}

function renameContextNode() {
  const node = contextMenuNode.value
  if (!node) {
    closeContextMenu()
    return
  }

  const nextTitle = window.prompt('重命名节点', node.title)
  closeContextMenu()
  if (nextTitle === null) return

  const trimmed = nextTitle.trim()
  if (trimmed) {
    node.title = trimmed.slice(0, 48)
  }
}

function duplicateContextNode() {
  const node = contextMenuNode.value
  if (!node) {
    closeContextMenu()
    return
  }

  insertNodeCopy(node)
  closeContextMenu()
}

function deleteContextNode() {
  const node = contextMenuNode.value
  if (node) {
    removeNode(node.id)
  }
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
  if (node.type === 'generation') {
    const referenceCount = referencedImageNodes(node).length
    const extraReferenceHeight = Math.max(0, referenceCount - 1) * 30
    return { ...size, height: size.height + extraReferenceHeight }
  }
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

function canStartPointerInteraction(event: PointerEvent) {
  return event.isPrimary && event.button === 0
}

function startNodeDrag(event: PointerEvent, node: CanvasNode) {
  if (!canStartPointerInteraction(event)) return
  event.preventDefault()
  selectNode(node.id)
  dragState.value = {
    nodeId: node.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: node.x,
    startY: node.y,
  }
}

function startNodeResize(event: PointerEvent, node: CanvasNode, corner: ResizeCorner) {
  if (!canStartPointerInteraction(event)) return
  event.preventDefault()
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

function startPan(event: PointerEvent) {
  if (!canStartPointerInteraction(event) || event.target !== event.currentTarget) return
  event.preventDefault()
  selectedNodeId.value = null
  closeContextMenu()
  panState.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: viewport.value.x,
    startY: viewport.value.y,
  }
}

function handleWindowPointerMove(event: PointerEvent) {
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

function handleWindowPointerUp(event: PointerEvent) {
  const draft = draftConnection.value
  if (draft) {
    const deltaX = event.clientX - draft.startClientX
    const deltaY = event.clientY - draft.startClientY
    if (Math.hypot(deltaX, deltaY) >= 12) {
      openContextMenuAtClient(event.clientX, event.clientY, {
        nodeId: draft.nodeId,
        handle: draft.handle,
        role: draft.role,
      })
      suppressNextClickClose()
    }
  }

  dragState.value = null
  panState.value = null
  resizeState.value = null
  draftConnection.value = null
}

function handleWindowPointerCancel() {
  dragState.value = null
  panState.value = null
  resizeState.value = null
  draftConnection.value = null
}

function shouldKeepNativeWheel(event: WheelEvent) {
  const target = event.target as HTMLElement | null
  return Boolean(target?.closest([
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '.mention-index',
    '.context-menu',
  ].join(',')))
}

function normalizedWheelValue(value: number, deltaMode: number) {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return value * 16
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return value * 120
  return value
}

function normalizedWheelDelta(event: WheelEvent) {
  return normalizedWheelValue(event.deltaY, event.deltaMode)
}

function setViewportZoomAtClient(clientX: number, clientY: number, nextZoom: number) {
  const rect = viewportRef.value?.getBoundingClientRect()
  const point = canvasPointFromClient(clientX, clientY)
  viewport.value = {
    x: clientX - (rect?.left ?? 0) - point.x * nextZoom,
    y: clientY - (rect?.top ?? 0) - point.y * nextZoom,
    zoom: nextZoom,
  }
}

function handleWheel(event: WheelEvent) {
  if (shouldKeepNativeWheel(event)) return

  event.preventDefault()
  const delta = normalizedWheelDelta(event)

  if (event.ctrlKey) {
    viewport.value.y -= delta
    return
  }

  if (event.altKey) {
    viewport.value.x -= normalizedWheelValue(event.deltaX || event.deltaY, event.deltaMode)
    return
  }

  const speed = event.metaKey ? 0.001 : 0.0014
  const nextZoom = clamp(viewport.value.zoom * Math.exp(-delta * speed), MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM)
  setViewportZoomAtClient(event.clientX, event.clientY, nextZoom)
}

function isOutputHandle(handle: CanvasHandle): handle is OutputHandle {
  return handle === 'text-out' || handle === 'image-out' || handle === 'generation-out'
}

function isInputHandle(handle: CanvasHandle): handle is InputHandle {
  return handle === 'prompt-in' || handle === 'reference-in' || handle === 'image-in'
}

function handleRole(handle: CanvasHandle): HandleRole {
  return isOutputHandle(handle) ? 'output' : 'input'
}

function startConnection(event: PointerEvent, node: CanvasNode, handle: CanvasHandle) {
  if (!canStartPointerInteraction(event)) return
  event.preventDefault()
  selectNode(node.id)
  const point = canvasPointFromClient(event.clientX, event.clientY)
  draftConnection.value = {
    nodeId: node.id,
    handle,
    role: handleRole(handle),
    cursorX: point.x,
    cursorY: point.y,
    startClientX: event.clientX,
    startClientY: event.clientY,
  }
}

function addConnectionIfValid(fromNodeId: string, fromHandle: OutputHandle, toNodeId: string, toHandle: InputHandle) {
  if (!isValidConnection(fromNodeId, fromHandle, toNodeId, toHandle)) return false

  const isDuplicate = connections.value.some(conn => (
    conn.fromNodeId === fromNodeId &&
    conn.fromHandle === fromHandle &&
    conn.toNodeId === toNodeId &&
    conn.toHandle === toHandle
  ))

  if (isDuplicate) return true

  connections.value = [
    ...connections.value,
    {
      id: createId('conn'),
      fromNodeId,
      fromHandle,
      toNodeId,
      toHandle,
    },
  ]

  const targetNode = getNodeById(toNodeId)
  if (targetNode?.type === 'generation' && toHandle === 'prompt-in') {
    syncMentionConnectionsForGeneration(targetNode)
  }

  return true
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

function outputHandlesForNode(node: CanvasNode): OutputHandle[] {
  if (node.type === 'text') return ['text-out']
  if (node.type === 'image') return ['image-out']
  return ['generation-out']
}

function inputHandlesForNode(node: CanvasNode): InputHandle[] {
  if (node.type === 'image') return ['image-in']
  if (node.type === 'generation') return ['prompt-in', 'reference-in']
  return []
}

function connectPendingMenuConnection(pending: PendingMenuConnection, node: CanvasNode) {
  if (pending.role === 'output' && isOutputHandle(pending.handle)) {
    for (const targetHandle of inputHandlesForNode(node)) {
      if (addConnectionIfValid(pending.nodeId, pending.handle, node.id, targetHandle)) return
    }
  }

  if (pending.role === 'input' && isInputHandle(pending.handle)) {
    for (const sourceHandle of outputHandlesForNode(node)) {
      if (addConnectionIfValid(node.id, sourceHandle, pending.nodeId, pending.handle)) return
    }
  }
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
  const textContentScale = node.type === 'text'
    ? (1 + (scale - 1) * TEXT_NODE_CONTENT_SCALE_FACTOR) / scale
    : 1
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    transform: `translate(${node.x}px, ${node.y}px) scale(${scale})`,
    transformOrigin: '0 0',
    '--node-text-content-scale': textContentScale.toFixed(4),
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
  const start = handlePoint(draft.nodeId, draft.handle)
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

function fallbackImageFileName(file: File) {
  if (file.name) return file.name
  const extension = file.type.split('/')[1] || 'png'
  return `剪贴板图片.${extension}`
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('图片读取失败'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

function readImageFileAsDataUrl(file: File) {
  return readBlobAsDataUrl(file)
}

function isInlineImageDataUrl(value: string) {
  return /^data:image\//i.test(value)
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(blob => resolve(blob), type, quality)
  })
}

async function compressReferenceImageDataUrl(dataUrl: string) {
  if (!isInlineImageDataUrl(dataUrl)) return dataUrl

  try {
    const image = await loadImageElement(dataUrl)
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    if (!sourceWidth || !sourceHeight) return dataUrl

    const scale = Math.min(1, REFERENCE_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return dataUrl

    context.drawImage(image, 0, 0, width, height)
    const blob = await canvasToBlob(canvas, 'image/webp', REFERENCE_IMAGE_WEBP_QUALITY)
    if (!blob) return dataUrl

    const compressed = await readBlobAsDataUrl(blob)
    return compressed.length < dataUrl.length || scale < 1 ? compressed : dataUrl
  } catch {
    return dataUrl
  }
}

async function applyImageFileToNode(nodeId: string, file: File) {
  const dataUrl = await compressReferenceImageDataUrl(await readImageFileAsDataUrl(file))
  const node = getNodeById(nodeId)
  if (!node) return
  node.imageUrl = dataUrl
  node.fileName = fallbackImageFileName(file)
  if (!/^图片\d+$/.test(node.title.trim())) {
    node.title = nextImageTitle(node.id)
  }
}

function chooseImage(nodeId: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    void applyImageFileToNode(nodeId, file).catch(() => {
      error.value = '图片读取失败，请重新选择图片。'
    })
  }
  input.click()
}

function clipboardImageFile(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? [])
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }

  return Array.from(event.clipboardData?.files ?? [])
    .find(file => file.type.startsWith('image/')) ?? null
}

async function handleWindowPaste(event: ClipboardEvent) {
  const file = clipboardImageFile(event)
  if (imageViewer.value || isEditableEventTarget(event)) return

  if (!file) {
    if (pasteNodeFromClipboard()) {
      event.preventDefault()
    }
    return
  }

  event.preventDefault()
  selectWorkspace('canvas')
  await nextTick()

  const position = nodePositionNearVisibleCenter('image') ?? { x: 720, y: 420 }
  const node = createNode('image', position.x, position.y, {
    title: nextImageTitle(),
    content: '',
  })

  try {
    await applyImageFileToNode(node.id, file)
  } catch {
    removeNode(node.id)
    error.value = '剪贴板图片读取失败，请重新复制图片后再试。'
  }
}

async function useHistoryImage(image: GeneratedImage, scope: ImageHistoryScope = 'mine') {
  let detail = image
  let previewUrl = displayImageUrl(detail)
  if (!previewUrl) {
    detail = await resolveImageDetail(image, scope)
    previewUrl = displayImageUrl(detail)
  }

  if (!previewUrl) {
    error.value = '图片加载失败，请稍后重试。'
    return
  }

  selectWorkspace('canvas')
  const rect = viewportRef.value?.getBoundingClientRect()
  const point = rect
    ? canvasPointFromClient(rect.left + rect.width * 0.56, rect.top + rect.height * 0.58)
    : { x: 720, y: 420 }

  createNode('image', point.x, point.y, {
    title: nextImageTitle(),
    content: '',
    imageUrl: previewUrl,
    sourceImageId: detail.id,
    sourceHistoryScope: scope,
    sourcePrompt: detail.prompt,
    fileName: detail.size,
  })
}

function isGallerySystemPromptBlock(block: string) {
  return (
    /^已上传 \d+ 张真实参考图/.test(block) &&
    block.includes('不要只根据文字重新想象')
  ) || /^.+: 第 \d+ 张参考图/.test(block)
}

function galleryUserPrompt(image: GeneratedImage) {
  return image.userPrompt || image.prompt
}

function galleryPrompt(image: GeneratedImage) {
  const prompt = galleryUserPrompt(image)?.trim()
  if (!prompt) return '无提示词'

  const visibleBlocks = prompt
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .filter(block => !isGallerySystemPromptBlock(block))

  return visibleBlocks.join('\n\n') || '无提示词'
}

function galleryReferences(image: GeneratedImage) {
  return image.references?.filter(reference => reference.dataUrl || reference.thumbnailUrl) ?? []
}

function galleryReferenceCount(image: GeneratedImage) {
  return typeof image.referenceImageCount === 'number'
    ? image.referenceImageCount
    : galleryReferences(image).length
}

function displayImageUrl(image: GeneratedImage) {
  return image.thumbnailUrl || image.dataUrl || ''
}

function displayReferenceUrl(reference: NonNullable<GeneratedImage['references']>[number]) {
  return reference.thumbnailUrl || reference.dataUrl || ''
}

function formatGalleryDate(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
  })
}

function galleryOptionLabel<T extends string>(
  value: T | undefined,
  options: Array<{ value: T; label: string }>,
) {
  if (!value) return 'Auto'
  return options.find(option => option.value === value)?.label ?? value
}

function galleryParamItems(image: GeneratedImage): GalleryParam[] {
  return [
    { label: '尺寸', value: image.size || 'auto' },
    { label: '比例', value: galleryOptionLabel(image.aspectRatio, aspectRatioOptions) },
    { label: '分辨率', value: galleryOptionLabel(image.resolution, resolutionOptions) },
    { label: '质量', value: galleryOptionLabel(image.quality, qualityOptions) },
  ]
}

function galleryDetailImageUrl(image: GeneratedImage) {
  return displayImageUrl(image)
}

function closeGalleryDetail() {
  galleryDetail.value = null
  galleryDetailScope.value = 'mine'
}

async function openGalleryDetail(image: GeneratedImage) {
  const scope = galleryActionScope.value
  galleryDetailScope.value = scope
  if (galleryDetailImageUrl(image)) {
    galleryDetail.value = image
    return
  }

  const detail = await resolveImageDetail(image, scope)
  if (!galleryDetailImageUrl(detail)) {
    error.value = '图片加载失败，请稍后重试。'
    return
  }

  galleryDetail.value = detail
}

async function openGalleryDetailViewer() {
  if (!galleryDetail.value) return
  const image = await resolveImageDetail(galleryDetail.value, galleryDetailScope.value)
  const imageUrl = image.dataUrl || galleryDetailImageUrl(image)
  if (!imageUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }

  galleryDetail.value = image
  imageViewer.value = {
    imageUrl,
    title: galleryFileName(image).replace(/\.png$/i, ''),
    caption: galleryPrompt(image),
    zoom: 1,
  }
}

function downloadGalleryDetail() {
  if (galleryDetail.value) {
    void downloadGeneratedImage(galleryDetail.value, galleryDetailScope.value)
  }
}

function useGalleryDetailImage() {
  if (galleryDetail.value) {
    void useHistoryImage(galleryDetail.value, galleryDetailScope.value)
    closeGalleryDetail()
  }
}

function sendGalleryDetailToChat() {
  if (galleryDetail.value) {
    void sendHistoryImageToChat(galleryDetail.value, galleryDetailScope.value)
  }
}

async function handleLoadMoreGallery() {
  if (
    !canLoadMoreGallery.value ||
    isGalleryAutoLoading.value ||
    (isPublicGalleryFilter.value ? isLoadingGallery.value : isLoadingHistory.value)
  ) return

  isGalleryAutoLoading.value = true
  try {
    if (isPublicGalleryFilter.value) {
      await ensureGalleryLoaded()
    }
    const localCount = filteredGalleryImages.value.length
    if (galleryVisibleCount.value < localCount) {
      galleryVisibleCount.value = Math.min(galleryVisibleCount.value + GALLERY_PAGE_SIZE, localCount)
      return
    }

    if (isPublicGalleryFilter.value) {
      if (!hasMoreGallery.value) return

      await loadMoreGalleryHistory()
    } else {
      if (!hasMoreHistory.value) return

      await loadMoreHistory()
    }
    const updatedCount = filteredGalleryImages.value.length
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

async function downloadGeneratedImage(image: GeneratedImage, scope: ImageHistoryScope = 'mine') {
  const detail = await resolveImageDetail(image, scope)
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

async function sendHistoryImageToChat(image: GeneratedImage, scope: ImageHistoryScope = 'mine') {
  const detail = await resolveImageDetail(image, scope)
  if (!detail.dataUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }
  emit('sendToChat', detail.dataUrl)
}

function selectWorkspace(mode: WorkspaceMode, options: { emitChange?: boolean } = {}) {
  activeWorkspace.value = mode
  closeContextMenu()
  if (mode === 'gallery' && isPublicGalleryFilter.value) {
    void ensureGalleryLoaded()
  }
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
    fontSize: 'calc(12px * var(--node-text-content-scale, 1))',
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

function generationUserPrompt(node: CanvasNode) {
  syncMentionConnectionsForGeneration(node)
  const promptText = hasPromptLink(node) ? getConnectedPrompt(node) : node.content.trim()
  return promptTextWithImageLabels(promptText)
}

function buildSystemPrompt(references: CanvasNode[]) {
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

  return [referenceGuide, ...referenceParts].filter(Boolean).join('\n\n')
}

function buildPromptParts(node: CanvasNode) {
  const userPrompt = generationUserPrompt(node)
  const references = referencedImageNodes(node)
  const systemPrompt = buildSystemPrompt(references)
  const modelPrompt = [systemPrompt, userPrompt].filter(Boolean).join('\n\n')

  return {
    userPrompt,
    systemPrompt,
    modelPrompt,
  }
}

function imageAltText(node: CanvasNode) {
  return node.content.trim() || node.sourcePrompt || node.title
}

function imageOutputMeta(node: CanvasNode) {
  return node.fileName || 'PNG'
}

function historyImageForNode(node: CanvasNode) {
  if (!node.sourceImageId) return null
  const sourceImages = node.sourceHistoryScope === 'public'
    ? gallerySourceImages.value
    : generatedImages.value
  return sourceImages.find(image => image.id === node.sourceImageId) ?? null
}

async function resolveNodeOriginalImageUrl(node: CanvasNode) {
  const historyImage = historyImageForNode(node)
  if (historyImage) {
    const detail = await resolveImageDetail(historyImage, node.sourceHistoryScope || 'mine')
    if (detail.dataUrl) return detail.dataUrl
  }

  return node.imageUrl || ''
}

async function resolveReferenceImageUrl(node: CanvasNode) {
  return await compressReferenceImageDataUrl(await resolveNodeOriginalImageUrl(node))
}

async function buildReferences(node: CanvasNode) {
  const imageNodes = referencedImageNodes(node)
    .filter((item): item is CanvasNode & { imageUrl: string } => Boolean(item.imageUrl))

  const references = await Promise.all(imageNodes.map(async item => ({
    id: item.id,
    title: item.title,
    dataUrl: await resolveReferenceImageUrl(item),
    content: item.content.trim() || undefined,
    fileName: item.fileName,
  })))

  return references.filter(reference => Boolean(reference.dataUrl))
}

async function generateFromNode(node: CanvasNode) {
  if (isGenerating.value || node.loading) return
  const { userPrompt, systemPrompt, modelPrompt } = buildPromptParts(node)
  if (!userPrompt.trim()) {
    node.error = '请连接文本节点或填写提示词。'
    return
  }

  node.loading = true
  node.error = null
  node.status = '正在准备生成...'
  const references = await buildReferences(node)
  node.status = references.length
    ? `正在上传 ${references.length} 张参考图并生成...`
    : '正在生成图片...'
  const result = await generate(modelPrompt, {
    userPrompt,
    systemPrompt,
    modelPrompt,
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
    imageUrl: displayImageUrl(result),
    sourceImageId: result.id,
    sourceHistoryScope: 'mine',
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

async function handleDownload(node: CanvasNode) {
  if (!node.imageUrl) return
  const imageUrl = await resolveNodeOriginalImageUrl(node)
  if (!imageUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }
  downloadImageUrl(imageUrl, node.content || node.title)
}

async function openImageViewer(node: CanvasNode) {
  if (!node.imageUrl) return
  const imageUrl = await resolveNodeOriginalImageUrl(node)
  if (!imageUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }
  imageViewer.value = {
    imageUrl,
    title: node.title,
    caption: imageAltText(node),
    zoom: 1,
  }
}

async function sendNodeImageToChat(node: CanvasNode) {
  if (!node.imageUrl) return
  const imageUrl = await resolveNodeOriginalImageUrl(node)
  if (!imageUrl) {
    error.value = '原图加载失败，请稍后重试。'
    return
  }
  emit('sendToChat', imageUrl)
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

function isEditableEventTarget(event: Event) {
  return event.target instanceof HTMLElement &&
    Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'))
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (imageViewer.value) {
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
    return
  }

  if (event.key === 'Escape' && contextMenu.value.visible) {
    event.preventDefault()
    closeContextMenu()
    return
  }

  const isCopyShortcut = (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'c'
  if (isCopyShortcut && !isEditableEventTarget(event) && copySelectedNode()) {
    event.preventDefault()
    return
  }

  if (event.key === 'Delete' && selectedNodeId.value && !isEditableEventTarget(event)) {
    event.preventDefault()
    removeNode(selectedNodeId.value)
    closeContextMenu()
  }
}

function fitView() {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect || !nodes.value.length) {
    viewport.value = { x: -120, y: -40, zoom: 1 }
    return
  }

  const isMobile = rect.width <= 760
  const targetNodes = isMobile
    ? nodes.value.filter(node => node.id === selectedNodeId.value)
    : nodes.value
  const boxes = (targetNodes.length ? targetNodes : nodes.value).map((node) => {
    const size = getRenderedNodeSize(node)
    return {
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
  const topInset = isMobile ? 142 : 24
  const bottomInset = isMobile ? 112 : 24
  const padding = isMobile ? 16 : 40
  const availableWidth = Math.max(1, rect.width - padding * 2)
  const availableHeight = Math.max(1, rect.height - topInset - bottomInset - padding * 2)
  const nextZoom = clamp(
    Math.min(MAX_VIEWPORT_ZOOM, availableWidth / contentWidth, availableHeight / contentHeight),
    MIN_VIEWPORT_ZOOM,
    MAX_VIEWPORT_ZOOM,
  )

  viewport.value = {
    x: padding + (availableWidth - contentWidth * nextZoom) / 2 - minX * nextZoom,
    y: topInset + padding + (availableHeight - contentHeight * nextZoom) / 2 - minY * nextZoom,
    zoom: nextZoom,
  }
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
  window.addEventListener('pointermove', handleWindowPointerMove)
  window.addEventListener('pointerup', handleWindowPointerUp)
  window.addEventListener('pointercancel', handleWindowPointerCancel)
  window.addEventListener('click', handleWindowClick)
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('paste', handleWindowPaste)

  requestAnimationFrame(() => {
    if ((viewportRef.value?.getBoundingClientRect().width ?? window.innerWidth) <= 760) {
      fitView()
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('pointermove', handleWindowPointerMove)
  window.removeEventListener('pointerup', handleWindowPointerUp)
  window.removeEventListener('pointercancel', handleWindowPointerCancel)
  window.removeEventListener('click', handleWindowClick)
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('paste', handleWindowPaste)
  if (suppressClickTimer !== null) {
    window.clearTimeout(suppressClickTimer)
    suppressClickTimer = null
  }
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
            <rect
              v-if="miniMapLayout.viewport"
              class="mini-viewport"
              :x="miniMapLayout.viewport.x"
              :y="miniMapLayout.viewport.y"
              :width="miniMapLayout.viewport.width"
              :height="miniMapLayout.viewport.height"
              rx="2"
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
        <div class="mobile-create-bar" aria-label="创建节点">
          <button type="button" @click="createNodeNearCenter('text')">
            <span class="mobile-create-icon">T</span>
            <span>文本</span>
          </button>
          <button type="button" @click="createNodeNearCenter('image')">
            <span class="mobile-create-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </span>
            <span>图片</span>
          </button>
          <button class="primary" type="button" @click="createNodeNearCenter('generation')">
            <span class="mobile-create-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
              </svg>
            </span>
            <span>生图</span>
          </button>
        </div>
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
        <span class="zoom-pill">{{ viewportZoomLabel }}</span>
      </div>

      <div
        ref="viewportRef"
        class="canvas-viewport"
        @contextmenu.prevent="openContextMenu"
        @pointerdown="startPan"
        @wheel="handleWheel"
      >
        <div class="graph-plane" :style="planeStyle" @pointerdown="startPan">
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
            @pointerdown.stop="selectNode(node.id)"
            @contextmenu.stop.prevent="openNodeContextMenu($event, node)"
          >
            <header class="node-header" @pointerdown.stop="startNodeDrag($event, node)">
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
                @pointerup="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'text')"
                @focus="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'text')"
                @pointerdown.stop
              />
              <div
                v-if="isMentionIndexOpen(node, 'text')"
                class="mention-index text-mention-index"
                @pointerdown.stop.prevent
              >
                <button
                  v-for="(imageNode, index) in mentionOptions"
                  :key="imageNode.id"
                  type="button"
                  :class="{ active: mentionState?.activeIndex === index }"
                  @pointerdown.prevent="insertMention(node, imageNode)"
                >
                  <img v-if="imageNode.imageUrl" :src="imageNode.imageUrl" :alt="imageNode.title">
                  <span>{{ imageNode.title }}</span>
                  <small>{{ imageNode.content || imageNode.fileName || '图片参考' }}</small>
                </button>
              </div>
              <span
                class="node-handle output"
                title="连接到生图节点"
                @pointerdown.stop.prevent="startConnection($event, node, 'text-out')"
                @pointerup.stop.prevent="finishConnection($event, node, 'text-out')"
              />
            </template>

            <template v-else-if="node.type === 'image'">
              <span
                class="node-handle input"
                title="接收生成结果"
                :class="{ connected: hasIncoming(node, 'image-in') }"
                @pointerdown.stop.prevent="startConnection($event, node, 'image-in')"
                @pointerup.stop.prevent="finishConnection($event, node, 'image-in')"
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
                  @pointerdown.stop
                >
              </div>
              <textarea
                v-else
                v-model="node.content"
                class="image-caption"
                placeholder="图片参考说明..."
                @pointerdown.stop
              />
              <div class="image-node-actions">
                <button type="button" :disabled="!node.imageUrl" @click.stop="createContinuation(node)">继续</button>
                <button type="button" :disabled="!node.imageUrl" @click.stop="handleDownload(node)">下载</button>
                <button type="button" :disabled="!node.imageUrl" @click.stop="sendNodeImageToChat(node)">对话</button>
              </div>
              <span
                class="node-handle output"
                title="作为参考图连接"
                @pointerdown.stop.prevent="startConnection($event, node, 'image-out')"
                @pointerup.stop.prevent="finishConnection($event, node, 'image-out')"
              />
            </template>

            <template v-else>
              <span
                class="node-handle input prompt"
                title="连接文本"
                :class="{ connected: hasIncoming(node, 'prompt-in') }"
                @pointerdown.stop.prevent="startConnection($event, node, 'prompt-in')"
                @pointerup.stop.prevent="finishConnection($event, node, 'prompt-in')"
              />
              <span
                class="node-handle input reference"
                title="连接参考图"
                :class="{ connected: hasIncoming(node, 'reference-in') }"
                @pointerdown.stop.prevent="startConnection($event, node, 'reference-in')"
                @pointerup.stop.prevent="finishConnection($event, node, 'reference-in')"
              />
              <span
                class="node-handle output generation"
                title="输出图片"
                @pointerdown.stop.prevent="startConnection($event, node, 'generation-out')"
                @pointerup.stop.prevent="finishConnection($event, node, 'generation-out')"
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
                    @pointerup="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'generation')"
                    @focus="updateMentionStateFromEditor($event.currentTarget as HTMLElement, node, 'generation')"
                    @pointerdown.stop
                  />
                  <div
                    v-if="isMentionIndexOpen(node, 'generation')"
                    class="mention-index generation-mention-index"
                    @pointerdown.stop.prevent
                  >
                    <button
                      v-for="(imageNode, index) in mentionOptions"
                      :key="imageNode.id"
                      type="button"
                      :class="{ active: mentionState?.activeIndex === index }"
                      @pointerdown.prevent="insertMention(node, imageNode)"
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
              @pointerdown.stop.prevent="startNodeResize($event, node, 'top-left')"
              @dblclick.stop.prevent="node.scale = 1"
            />
            <span
              class="resize-corner top-right"
              @pointerdown.stop.prevent="startNodeResize($event, node, 'top-right')"
              @dblclick.stop.prevent="node.scale = 1"
            />
            <span
              class="resize-corner bottom-left"
              @pointerdown.stop.prevent="startNodeResize($event, node, 'bottom-left')"
              @dblclick.stop.prevent="node.scale = 1"
            />
            <span
              class="resize-corner bottom-right"
              @pointerdown.stop.prevent="startNodeResize($event, node, 'bottom-right')"
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
          <template v-if="contextMenuNode">
            <button type="button" @click="renameContextNode">
              <span class="menu-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </span>
              <span>重命名</span>
            </button>
            <button type="button" @click="duplicateContextNode">
              <span class="menu-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                  <rect x="8" y="8" width="11" height="11" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                </svg>
              </span>
              <span>复制节点</span>
            </button>
            <button type="button" class="danger" @click="deleteContextNode">
              <span class="menu-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="m6 6 1 15h10l1-15" />
                </svg>
              </span>
              <span>删除</span>
            </button>
          </template>
          <template v-else>
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
          </template>
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
        <button class="tool-button" type="button" title="缩小" @click="viewport.zoom = Math.max(MIN_VIEWPORT_ZOOM, viewport.zoom - 0.08)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
            <circle cx="11" cy="11" r="7" />
            <path d="M8 11h6" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
        <input v-model.number="viewport.zoom" class="zoom-range" type="range" :min="MIN_VIEWPORT_ZOOM" :max="MAX_VIEWPORT_ZOOM" step="0.02" aria-label="缩放">
        <button class="tool-button" type="button" title="放大" @click="viewport.zoom = Math.min(MAX_VIEWPORT_ZOOM, viewport.zoom + 0.08)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
            <circle cx="11" cy="11" r="7" />
            <path d="M8 11h6" />
            <path d="M11 8v6" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
        <span class="zoom-pill">{{ viewportZoomLabel }}</span>
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
        <div class="gallery-heading">
          <span class="gallery-eyebrow">作品广场</span>
          <h2>生成作品</h2>
          <p>{{ filteredGalleryImages.length }} / {{ gallerySourceImages.length }}</p>
        </div>
        <div class="gallery-toolbar">
          <div class="gallery-filter-group" role="tablist" aria-label="作品筛选">
            <button
              v-for="option in galleryFilterOptions"
              :key="option.value"
              type="button"
            :class="{ active: galleryFilter === option.value }"
            @click="galleryFilter = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <label class="gallery-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16">
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4" />
            </svg>
            <input v-model="galleryQuery" type="search" placeholder="搜索提示词、尺寸、参考图">
          </label>
          <button
            type="button"
            class="gallery-reset"
            :disabled="!galleryHasFilter"
            @click="galleryQuery = ''; galleryFilter = 'mine'"
          >
            重置
          </button>
        </div>
      </div>

      <div v-if="visibleGalleryImages.length" class="gallery-grid" aria-live="polite">
        <article v-for="image in visibleGalleryImages" :key="image.id" class="gallery-card">
          <button type="button" class="gallery-image-wrap" title="查看作品" @click="openGalleryDetail(image)">
            <span class="gallery-card-date">{{ formatGalleryDate(image.timestamp) }}</span>
            <span v-if="galleryReferenceCount(image)" class="gallery-card-reference-count">
              {{ galleryReferenceCount(image) }} 张参考
            </span>
            <span class="gallery-image-button">
              <img :src="displayImageUrl(image)" :alt="galleryPrompt(image)" loading="lazy">
            </span>
          </button>
          <div class="gallery-card-body">
            <p class="gallery-card-prompt">{{ galleryPrompt(image) }}</p>
            <div class="gallery-card-meta">
              <span>{{ image.size || 'auto' }}</span>
              <span>{{ galleryOptionLabel(image.resolution, resolutionOptions) }}</span>
              <span>{{ galleryOptionLabel(image.quality, qualityOptions) }}</span>
            </div>
            <div class="gallery-card-footer">
              <div class="gallery-reference-strip" aria-label="参考图">
                <img
                  v-for="reference in galleryReferences(image).slice(0, 3)"
                  :key="reference.id || reference.title"
                  :src="displayReferenceUrl(reference)"
                  :alt="reference.title || '参考图'"
                  loading="lazy"
                >
              </div>
              <div class="gallery-actions">
                <button type="button" title="查看作品" @click="openGalleryDetail(image)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                    <path d="M15 3h6v6" />
                    <path d="M10 14 21 3" />
                    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                  </svg>
                </button>
                <button type="button" title="放入画布" @click="useHistoryImage(image, galleryActionScope)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <button type="button" title="下载原图" @click="downloadGeneratedImage(image, galleryActionScope)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 19h14" />
                  </svg>
                </button>
                <button
                  type="button"
                  title="发送到对话"
                  @click="sendHistoryImageToChat(image, galleryActionScope)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="gallery-empty">
        <strong>{{ (isPublicGalleryFilter ? (!galleryLoaded && isLoadingGallery) : isLoadingHistory) ? '正在加载作品' : (gallerySourceImages.length ? '没有匹配作品' : '暂无作品') }}</strong>
        <span v-if="galleryHasFilter && (!isPublicGalleryFilter || galleryLoaded)">换一个筛选或搜索词</span>
      </div>

      <div v-if="visibleGalleryImages.length && (isGalleryAutoLoading || (isPublicGalleryFilter ? isLoadingGallery : isLoadingHistory))" class="gallery-scroll-status">
        加载中...
      </div>

      <div v-if="error" class="global-error">{{ error }}</div>
    </section>

    <Teleport to="body">
      <div
        v-if="galleryDetail"
        class="gallery-detail-overlay"
        @pointerdown.self="closeGalleryDetail"
      >
        <article class="gallery-detail-shell" @pointerdown.stop>
          <section class="gallery-detail-preview">
            <img
              :src="galleryDetailImageUrl(galleryDetail)"
              :alt="galleryPrompt(galleryDetail)"
              draggable="false"
            >
            <button type="button" class="gallery-detail-zoom" title="放大查看" @click="openGalleryDetailViewer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
                <circle cx="11" cy="11" r="7" />
                <path d="M8 11h6" />
                <path d="M11 8v6" />
                <path d="m16 16 4 4" />
              </svg>
            </button>
          </section>
          <aside class="gallery-detail-panel">
            <header class="gallery-detail-header">
              <div>
                <span>作品详情</span>
                <strong>{{ galleryFileName(galleryDetail).replace(/\.png$/i, '') }}</strong>
              </div>
              <button type="button" title="关闭" @click="closeGalleryDetail">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </header>

            <section class="gallery-detail-section">
              <h3>用户提示词</h3>
              <p>{{ galleryPrompt(galleryDetail) }}</p>
            </section>

            <section class="gallery-detail-section">
              <div class="gallery-detail-section-title">
                <h3>参考图</h3>
                <span>{{ galleryReferenceCount(galleryDetail) }} 张</span>
              </div>
              <div v-if="galleryReferences(galleryDetail).length" class="gallery-detail-references">
                <figure
                  v-for="reference in galleryReferences(galleryDetail)"
                  :key="reference.id || reference.title"
                >
                  <img :src="displayReferenceUrl(reference)" :alt="reference.title || '参考图'" loading="lazy">
                  <figcaption>{{ reference.title || reference.fileName || '参考图' }}</figcaption>
                </figure>
              </div>
              <p v-else class="gallery-detail-muted">
                {{ galleryReferenceCount(galleryDetail) ? '参考图未公开展示' : '没有参考图' }}
              </p>
            </section>

            <section class="gallery-detail-section">
              <h3>生成参数</h3>
              <dl class="gallery-param-grid">
                <template v-for="item in galleryParamItems(galleryDetail)" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </template>
              </dl>
            </section>

            <div class="gallery-detail-actions">
              <button type="button" @click="useGalleryDetailImage">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                放入画布
              </button>
              <button type="button" @click="downloadGalleryDetail">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 19h14" />
                </svg>
                下载
              </button>
              <button type="button" @click="sendGalleryDetailToChat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                </svg>
                对话
              </button>
            </div>
          </aside>
        </article>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="imageViewer"
        class="image-viewer-overlay"
        @pointerdown.self="closeImageViewer"
      >
        <div class="image-viewer-shell" @pointerdown.stop>
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
  border: 1px solid #cbd5e1;
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

.mini-viewport {
  fill: rgba(37, 99, 235, 0.08);
  stroke: #111827;
  stroke-width: 0.9;
  stroke-dasharray: 3 2;
  pointer-events: none;
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
  padding: 26px clamp(18px, 3vw, 42px);
  overflow-y: auto;
  background: #f4f6f8;
}

.gallery-header {
  display: grid;
  align-items: start;
  gap: 14px;
  margin: 0 auto 20px;
  max-width: 1540px;
}

.gallery-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.gallery-eyebrow {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.gallery-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 28px;
  letter-spacing: 0;
}

.gallery-header p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.gallery-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  gap: 10px;
  min-width: 0;
}

.gallery-filter-group {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.gallery-filter-group button,
.gallery-reset,
.gallery-actions button {
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: #fff;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.gallery-filter-group button {
  padding: 0 12px;
  color: var(--text-secondary);
}

.gallery-filter-group button.active {
  background: #111827;
  color: #fff;
}

.gallery-search {
  display: flex;
  align-items: center;
  min-width: 220px;
  height: 42px;
  flex: 1 1 360px;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-muted);
}

.gallery-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
}

.gallery-search input::placeholder {
  color: #a8b1bf;
}

.gallery-reset {
  padding: 0 12px;
  border-color: var(--border);
}

.gallery-reset:disabled {
  opacity: 0.42;
  pointer-events: none;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  align-items: start;
  gap: 16px;
  max-width: 1540px;
  margin: 0 auto;
}

.gallery-card {
  display: grid;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
}

.gallery-image-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--border);
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    #f8fafc;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  background-size: 18px 18px;
  cursor: zoom-in;
  overflow: hidden;
}

.gallery-image-wrap img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.gallery-image-button {
  display: block;
  width: 100%;
  height: 100%;
}

.gallery-image-wrap:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.gallery-card-date,
.gallery-card-reference-count {
  position: absolute;
  z-index: 1;
  top: 10px;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  backdrop-filter: blur(8px);
}

.gallery-card-date {
  left: 10px;
}

.gallery-card-reference-count {
  right: 10px;
}

.gallery-card-body {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.gallery-card-prompt {
  display: -webkit-box;
  min-height: 38px;
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  line-height: 1.46;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.gallery-card-meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.gallery-card-meta span {
  max-width: 100%;
  padding: 3px 7px;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.gallery-reference-strip {
  display: flex;
  min-width: 0;
  height: 30px;
}

.gallery-reference-strip img {
  width: 30px;
  height: 30px;
  margin-right: -7px;
  border: 2px solid #fff;
  border-radius: 8px;
  background: #fff;
  object-fit: cover;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.14);
}

.gallery-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 5px;
}

.gallery-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  min-height: 32px;
  padding: 0;
  border-color: var(--border);
  color: var(--text-secondary);
}

.gallery-actions button:hover {
  border-color: var(--border-strong);
  background: var(--surface-soft);
  color: var(--text-primary);
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
  gap: 8px;
  min-height: 320px;
  max-width: 720px;
  margin: 0 auto;
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
  box-sizing: border-box;
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

.node-image,
.node-generation {
  overflow: visible;
}

.node-header {
  flex: 0 0 auto;
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
  font-size: calc(13px * var(--node-text-content-scale, 1));
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
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-height: 0;
  margin: 10px 10px 0;
  border-radius: 7px;
  background: #f8fafc;
  overflow: hidden;
}

.image-preview.empty {
  min-height: 136px;
  border: 1px dashed var(--border-strong);
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    #f8fafc;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.image-preview img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 206px;
  border-radius: 7px;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    #f8fafc;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  object-fit: contain;
}

.image-preview.generated {
  max-height: 214px;
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
  flex: 0 0 48px;
  padding: 8px 10px 2px;
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
}

.image-output-panel {
  flex: 0 0 auto;
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
  flex: 0 0 auto;
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

.gallery-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(10, 15, 25, 0.62);
  backdrop-filter: blur(8px);
}

.gallery-detail-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  width: min(1180px, calc(100vw - 48px));
  height: min(760px, calc(100dvh - 48px));
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 32px 80px rgba(15, 23, 42, 0.32);
}

.gallery-detail-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  background: #f8fafc;
}

.gallery-detail-preview img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.16) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.16) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.16) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.16) 75%),
    #f8fafc;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
  object-fit: contain;
  box-shadow: 0 18px 52px rgba(15, 23, 42, 0.16);
  -webkit-user-drag: none;
}

.gallery-detail-zoom {
  position: absolute;
  right: 18px;
  bottom: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.52);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  cursor: zoom-in;
  backdrop-filter: blur(8px);
}

.gallery-detail-panel {
  display: grid;
  align-content: start;
  grid-auto-rows: max-content;
  gap: 18px;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  border-left: 1px solid var(--border);
  overflow-y: auto;
}

.gallery-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.gallery-detail-header div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.gallery-detail-header span,
.gallery-detail-section-title span,
.gallery-detail-muted {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.gallery-detail-header strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 900;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-detail-header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
}

.gallery-detail-section {
  display: grid;
  gap: 9px;
  min-width: 0;
}

.gallery-detail-section h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.gallery-detail-section p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.58;
  white-space: pre-wrap;
  word-break: break-word;
}

.gallery-detail-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.gallery-detail-references {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 9px;
}

.gallery-detail-references figure {
  min-width: 0;
  margin: 0;
}

.gallery-detail-references img {
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  object-fit: cover;
}

.gallery-detail-references figcaption {
  margin-top: 5px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-param-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.gallery-param-grid dt,
.gallery-param-grid dd {
  min-width: 0;
  margin: 0;
}

.gallery-param-grid dt {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.gallery-param-grid dd {
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.gallery-detail-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.gallery-detail-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.gallery-detail-actions button:first-child {
  background: #111827;
  color: #fff;
}

.gallery-detail-actions button:hover,
.gallery-detail-header button:hover {
  border-color: var(--border-strong);
  background: var(--surface-soft);
  color: var(--text-primary);
}

.gallery-detail-actions button:first-child:hover {
  background: #020617;
  color: #fff;
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
  overflow: hidden;
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
  max-height: none;
  overflow: hidden;
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

.context-menu button.danger {
  color: var(--danger);
}

.context-menu button.danger .menu-icon {
  color: var(--danger);
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

.mobile-create-bar {
  display: none;
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

.canvas-viewport {
  touch-action: none;
}

.node-header,
.node-handle,
.resize-corner {
  touch-action: none;
}

.toolbar-divider {
  width: 1px;
  height: 22px;
  background: var(--border);
}

.zoom-pill {
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

  .mobile-create-bar {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    min-width: 0;
  }

  .mobile-create-bar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 68px;
    min-height: 40px;
    padding: 0 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 900;
    white-space: nowrap;
  }

  .mobile-create-bar button.primary {
    min-width: 76px;
    border-color: #111827;
    background: #111827;
    color: #fff;
  }

  .mobile-create-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    font-weight: 900;
  }

  .stage-actions {
    left: 10px;
    right: auto;
    top: 10px;
    width: max-content;
    max-width: calc(100% - 20px);
    overflow-x: auto;
    flex-wrap: nowrap;
    justify-content: flex-start;
    padding: 6px;
    scrollbar-width: thin;
  }

  .bottom-toolbar {
    left: 10px;
    right: 10px;
    bottom: 10px;
    flex-wrap: wrap;
    justify-content: flex-start;
    padding: 8px;
  }

  .tool-button {
    width: 44px;
    height: 44px;
  }

  .zoom-pill {
    min-width: 44px;
    height: 34px;
  }

  .zoom-range {
    flex: 1 1 120px;
    min-width: 120px;
    height: 34px;
  }

  .node-header {
    min-height: 56px;
    padding: 0 8px 0 12px;
  }

  .node-remove {
    width: 48px;
    height: 48px;
    opacity: 1;
  }

  .node-handle {
    width: 30px;
    height: 30px;
    border-width: 3px;
  }

  .node-handle.input {
    left: -16px;
  }

  .node-handle.output {
    right: -16px;
  }

  .resize-corner {
    width: 44px;
    height: 44px;
  }

  .resize-corner.top-left {
    left: -12px;
    top: -12px;
  }

  .resize-corner.top-right {
    right: -12px;
    top: -12px;
  }

  .resize-corner.bottom-left {
    left: -12px;
    bottom: -12px;
  }

  .resize-corner.bottom-right {
    right: -12px;
    bottom: -12px;
  }

  .pick-image {
    width: 64px;
    height: 64px;
  }

  .replace-image,
  .zoom-image {
    width: 52px;
    height: 52px;
  }

  .image-node-actions button,
  .gallery-actions button,
  .segmented button,
  .generate-button,
  .mention-index button {
    min-height: 58px;
  }

  .gallery-stage {
    padding: 16px;
  }

  .gallery-header {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }

  .gallery-toolbar {
    align-items: stretch;
    flex-direction: column;
    min-width: 0;
  }

  .gallery-filter-group {
    width: 100%;
  }

  .gallery-filter-group button {
    flex: 1;
    min-height: 42px;
  }

  .gallery-search {
    width: 100%;
    min-width: 0;
    height: 42px;
    flex: 0 0 auto;
  }

  .gallery-reset {
    min-height: 42px;
  }

  .gallery-grid {
    grid-template-columns: 1fr;
  }

  .gallery-actions {
    gap: 8px;
  }

  .gallery-detail-overlay,
  .image-viewer-overlay {
    padding: 10px;
  }

  .gallery-detail-shell {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(260px, 48vh) minmax(0, 1fr);
    width: calc(100vw - 20px);
    height: calc(100dvh - 20px);
  }

  .gallery-detail-preview {
    padding: 12px;
  }

  .gallery-detail-panel {
    border-top: 1px solid var(--border);
    border-left: 0;
  }

  .gallery-detail-actions {
    grid-template-columns: 1fr;
  }

  .gallery-detail-actions button {
    min-height: 48px;
  }

  .image-viewer-shell {
    width: calc(100vw - 20px);
    height: min(88vh, calc(100dvh - 20px));
  }

  .image-viewer-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 12px;
  }

  .image-viewer-controls {
    width: 100%;
    flex-wrap: wrap;
  }

  .image-viewer-controls button {
    min-width: 44px;
    height: 44px;
  }

  .image-viewer-stage {
    padding: 12px;
  }
}
</style>
