<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useImageGen, type ImageHistoryScope } from '../composables/useImageGen'
import { useMeasuredCanvasNodes } from '../composables/useMeasuredCanvasNodes'
import { useCanvasDocumentFiles } from '../composables/useCanvasDocumentFiles'
import { useGalleryDetailPreview } from '../composables/useGalleryDetailPreview'
import { useImageCanvasDocument } from '../composables/useImageCanvasDocument'
import { useImageCanvasGeneration } from '../composables/useImageCanvasGeneration'
import { useImageCanvasGraph } from '../composables/useImageCanvasGraph'
import { useImageCanvasImages } from '../composables/useImageCanvasImages'
import { useImageCanvasMentions } from '../composables/useImageCanvasMentions'
import { useImageCanvasViewer } from '../composables/useImageCanvasViewer'
import { useImageGalleryStage } from '../composables/useImageGalleryStage'
import { useImageNodeReferences } from '../composables/useImageNodeReferences'
import { useAppConfig } from '../composables/useAppConfig'
import { type CanvasExportDocument } from '../lib/canvas-document'
import { useImageDownload, type ImageDownloadNode, type ImageDownloadViewer } from '../composables/useImageDownload'
import {
  CANVAS_EXPORT_VERSION,
  CANVAS_IMPORT_MAX_FILE_BYTES,
  CANVAS_TITLE,
  MAX_NODE_SCALE,
  MAX_VIEWPORT_ZOOM,
  MENU_HEIGHT,
  MENU_WIDTH,
  MIN_NODE_SCALE,
  MIN_VIEWPORT_ZOOM,
  PLANE_SIZE,
  type CanvasNode,
  type CanvasNodeType,
  type ContextMenuState,
  type DragState,
  type InputHandle,
  type NodeAspectRatio,
  type NodeQuality,
  type NodeResolution,
  type PanState,
  type PendingMenuConnection,
  type ResizeCorner,
  type ResizeState,
  type WorkspaceMode,
} from '../lib/image-canvas-model'
import {
  clamp,
  getNodeScale,
  isGeneratedImageNode,
  updateNodeImageDimensions,
} from '../lib/image-canvas-utils'
import {
  galleryFileName,
  galleryParamItems as buildGalleryParamItems,
  galleryPrompt,
  galleryReferenceCount,
  galleryReferences,
  previewImageUrl,
} from '../lib/image-gallery'
import {
  buildMiniMapLayout,
  canvasPlaneStyle,
  canvasPointFromClientPoint,
  DEFAULT_CANVAS_VIEWPORT,
  fitViewportToNodeBoxes,
  nodePositionNearVisibleCenter as nodePositionNearVisibleCenterForViewport,
  normalizedWheelDelta,
  normalizedWheelValue,
  viewportForClientZoom,
} from '../lib/image-canvas-viewport'
import type { GeneratedImage } from '../types/image'
import ImageCanvasBottomToolbar from './ImageCanvasBottomToolbar.vue'
import ImageCanvasContextMenu from './ImageCanvasContextMenu.vue'
import ImageCanvasNode from './ImageCanvasNode.vue'
import ImageCanvasSidebar from './ImageCanvasSidebar.vue'
import ImageCanvasStageActions from './ImageCanvasStageActions.vue'
import ImageCanvasGalleryStage from './ImageCanvasGalleryStage.vue'
import ImageGalleryDetailModal from './ImageGalleryDetailModal.vue'
import ImageViewerModal from './ImageViewerModal.vue'
import ImagioView from './ImagioView.vue'
import ImagioSidebar from './ImagioSidebar.vue'

const props = defineProps<{
  workspaceMode?: WorkspaceMode
  imageMode?: 'imagio' | 'canvas'
  canSelectGenerationCount?: boolean
}>()

const emit = defineEmits<{
  sendToChat: [dataUrl: string]
  workspaceChange: [mode: WorkspaceMode]
  imageModeChange: [mode: 'imagio' | 'canvas']
}>()

const { config: _appConfig, ensureAppConfig } = useAppConfig()

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
  clearHistory,
  loadMoreHistory,
  ensureGalleryLoaded,
  loadMoreGalleryHistory,
  resolveImageDetail,
} = useImageGen()

const viewportRef = ref<HTMLElement | null>(null)
const {
  canvasId,
  nodes,
  connections,
  selectedNodeId,
  createId,
  createNode,
  nextImageTitle,
  getNodeById,
  insertNodeCopy,
  copySelectedNode: copySelectedDocumentNode,
  pasteNodeFromClipboard: pasteDocumentNodeFromClipboard,
  removeNode: removeDocumentNode,
  clearCanvas: clearCanvasDocument,
  importDocument: importCanvasDocumentState,
} = useImageCanvasDocument()
const dragState = ref<DragState | null>(null)
const panState = ref<PanState | null>(null)
const resizeState = ref<ResizeState | null>(null)
const viewport = ref({ ...DEFAULT_CANVAS_VIEWPORT })
const viewportZoomLabel = computed(() => `${Math.round(viewport.value.zoom * 100)}%`)
const activeWorkspace = ref<WorkspaceMode>('canvas')
const currentImageMode = ref<'imagio' | 'canvas'>('imagio')

// Sync imageMode from props
watch(
  () => props.imageMode,
  (mode) => {
    if (mode && mode !== currentImageMode.value) {
      currentImageMode.value = mode
    }
  },
  { immediate: true },
)

function handleImageModeChange(mode: 'imagio' | 'canvas') {
  currentImageMode.value = mode
  emit('imageModeChange', mode)
}
const contextMenu = ref<ContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  canvasX: 0,
  canvasY: 0,
  pendingConnection: null as PendingMenuConnection | null,
  targetNodeId: null,
})

let suppressNextWindowClick = false
let suppressClickTimer: number | null = null

const {
  cleanupMeasuredNodeElement,
  measuredNodeRef,
  getBaseNodeSize,
  getRenderedNodeSize,
  clearMeasuredNodes,
} = useMeasuredCanvasNodes({
  getNodeById,
  referenceCountForNode: node => referencedImageNodes(node).length,
})

const {
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
} = useImageCanvasGraph({
  canvasId,
  canvasVersion: CANVAS_EXPORT_VERSION,
  nodes,
  connections,
  getNodeById,
  createConnectionId: () => createId('conn'),
  getBaseNodeSize,
  getRenderedNodeSize,
  canvasPointFromClient,
  canStartPointerInteraction,
  selectNode,
})

const {
  mentionState,
  mentionOptions,
  updateRichEditorContent,
  updateMentionStateFromEditor,
  isMentionIndexOpen,
  insertMention,
  handleMentionKeydown,
} = useImageCanvasMentions({
  nodes,
  syncMentionConnectionsForGeneration,
  syncMentionConnectionsForTextNode,
})

watch(
  () => props.workspaceMode,
  (mode) => {
    if (mode && mode !== activeWorkspace.value) {
      selectWorkspace(mode, { emitChange: false })
    }
  },
  { immediate: true },
)

const planeStyle = computed(() => canvasPlaneStyle(viewport.value))

const miniMapLayout = computed(() => {
  const miniNodes = nodes.value.map((node) => {
    const size = getRenderedNodeSize(node)
    return {
      id: node.id,
      type: node.type,
      selected: selectedNodeId.value === node.id,
      x: node.x,
      y: node.y,
      width: size.width,
      height: size.height,
    }
  })

  return buildMiniMapLayout({
    nodes: miniNodes,
    connections: connections.value.map((connection) => {
      return {
        id: connection.id,
        start: handlePoint(connection.fromNodeId, connection.fromHandle),
        end: handlePoint(connection.toNodeId, connection.toHandle),
      }
    }),
    viewport: viewport.value,
    viewportRect: viewportRef.value?.getBoundingClientRect(),
  })
})

const historyImages = computed(() => generatedImages.value.slice(0, 6))
const {
  query: galleryQuery,
  filter: galleryFilter,
  filterOptions: galleryFilterOptions,
  isPublicFilter: isPublicGalleryFilter,
  actionScope: galleryActionScope,
  sourceImages: gallerySourceImages,
  filteredImages: filteredGalleryImages,
  visibleImages: visibleGalleryImages,
  hasFilter: galleryHasFilter,
  isLoading: isGalleryLoading,
  isLoadingMore: isGalleryLoadingMore,
  loadMore: handleLoadMoreGallery,
} = useImageGalleryStage({
  generatedImages,
  publicGalleryImages,
  isLoadingHistory,
  hasMoreHistory,
  isLoadingGallery,
  hasMoreGallery,
  ensureGalleryLoaded,
  loadMoreHistory,
  loadMoreGalleryHistory,
})
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
const contextMenuNode = computed(() => (
  contextMenu.value.targetNodeId ? getNodeById(contextMenu.value.targetNodeId) ?? null : null
))

function historyImageForViewer(viewer: ImageDownloadViewer) {
  if (!viewer.sourceImageId) return null
  const scopedImages = viewer.sourceScope === 'public'
    ? publicGalleryImages.value
    : generatedImages.value
  return scopedImages.find(image => image.id === viewer.sourceImageId) ??
    [...generatedImages.value, ...publicGalleryImages.value].find(image => image.id === viewer.sourceImageId) ??
    null
}

const {
  galleryDetail,
  galleryDetailScope,
  isGalleryDetailLoadingPreview,
  galleryDetailImageUrl,
  closeGalleryDetail,
  openGalleryDetail,
  createViewerState: createGalleryDetailViewerState,
  resolveViewerPreview: resolveGalleryDetailViewerPreview,
} = useGalleryDetailPreview({
  currentScope: () => galleryActionScope.value,
  resolveImageDetail,
  setError(message) {
    error.value = message
  },
})

const {
  buildReferences,
  resolveNodePreviewImageUrl,
} = useImageNodeReferences({
  historyImageForNode: node => historyImageForNode(node),
  referencedImageNodes: node => referencedImageNodes(node),
  resolveImageDetail,
})

const {
  imageDownloadKey,
  nodeDownloadKey,
  viewerDownloadKey: imageViewerDownloadKey,
  isDownloadingImage,
  generatedImageTarget,
  nodeTarget,
  viewerTarget,
  preloadTarget,
  downloadTarget,
} = useImageDownload({
  resolveImageDetail,
  imageFileName: galleryFileName,
  historyImageForNode,
  historyImageForViewer,
  setError(message) {
    error.value = message
  },
})

const {
  imageViewer,
  openGalleryDetailViewer,
  openImageViewer,
  closeImageViewer,
  zoomImageViewer,
  resetImageViewerZoom,
} = useImageCanvasViewer({
  historyImageForNode: node => historyImageForNode(node),
  resolveNodePreviewImageUrl,
  createGalleryDetailViewerState,
  resolveGalleryDetailViewerPreview,
})

const {
  chooseImage,
  handleWindowPaste,
  useHistoryImage,
} = useImageCanvasImages({
  getNodeById,
  createImageNode: (x, y, data) => createNode('image', x, y, data),
  nextImageTitle,
  removeNode,
  pasteNodeFromClipboard: pasteDocumentNodeFromClipboard,
  selectCanvasWorkspace: () => selectWorkspace('canvas'),
  isImageViewerOpen: () => Boolean(imageViewer.value),
  isEditableEventTarget,
  imageNodePositionNearCenter: () => nodePositionNearVisibleCenter('image'),
  historyImageDropPoint: () => {
    const rect = viewportRef.value?.getBoundingClientRect()
    return rect
      ? canvasPointFromClient(rect.left + rect.width * 0.56, rect.top + rect.height * 0.58)
      : { x: 720, y: 420 }
  },
  resolveImageDetail,
  setError(message) {
    error.value = message
  },
})

const {
  generationCountOptions,
  generationCountForNode,
  setGenerationCount,
  generateFromNode: generateFromNodeWithConfig,
  createContinuation,
} = useImageCanvasGeneration({
  nodes,
  connections,
  isGenerating,
  error,
  canSelectGenerationCount: () => Boolean(props.canSelectGenerationCount),
  canvasContextEnabled: () => appConfig.value.canvasContextEnabled,
  createNode,
  createConnectionId: () => createId('conn'),
  getRenderedNodeSize,
  buildReferences,
  buildPromptParts,
  buildCanvasContext,
  generate,
})

async function generateFromNode(node: CanvasNode) {
  await ensureAppConfig()
  await generateFromNodeWithConfig(node)
}

function updateNodeContent(node: CanvasNode, value: string) {
  node.content = value
}

function updateNodeResolution(node: CanvasNode, value: NodeResolution) {
  node.resolution = value
}

function updateNodeAspectRatio(node: CanvasNode, value: NodeAspectRatio) {
  node.aspectRatio = value
}

function updateNodeQuality(node: CanvasNode, value: NodeQuality) {
  node.quality = value
}

function resetNodeScale(node: CanvasNode) {
  node.scale = 1
}

function canvasPointFromClient(clientX: number, clientY: number) {
  return canvasPointFromClientPoint(
    clientX,
    clientY,
    viewportRef.value?.getBoundingClientRect(),
    viewport.value,
  )
}

function nodePositionNearVisibleCenter(type: CanvasNodeType) {
  return nodePositionNearVisibleCenterForViewport(
    type,
    viewportRef.value?.getBoundingClientRect(),
    viewport.value,
    nodes.value.length,
  )
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

function importCanvasDocument(document: CanvasExportDocument, mode: 'append' | 'replace' = 'append') {
  const imported = importCanvasDocumentState(document, mode)
  if (!imported.append) {
    viewport.value = imported.viewport
  }

  activeWorkspace.value = 'canvas'
  void nextTick(() => {
    if (imported.append) fitView()
  })
}

const { exportCanvasToFile, importCanvasFromFile } = useCanvasDocumentFiles({
  canvasId,
  title: CANVAS_TITLE,
  version: CANVAS_EXPORT_VERSION,
  getViewport: () => ({ ...viewport.value }),
  getNodes: () => nodes.value,
  getConnections: () => connections.value,
  importDocument: importCanvasDocument,
  setError(message) {
    error.value = message
  },
  maxFileBytes: CANVAS_IMPORT_MAX_FILE_BYTES,
})

function copySelectedNode() {
  const copied = copySelectedDocumentNode()
  if (copied) closeContextMenu()
  return copied
}

function _pasteNodeFromClipboard() {
  const pasted = pasteDocumentNodeFromClipboard()
  if (pasted) closeContextMenu()
  return pasted
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

  updateDraftCursor(event.clientX, event.clientY)
}

function handleWindowPointerUp(event: PointerEvent) {
  const pendingConnection = pendingConnectionForPointerUp(event)
  if (pendingConnection) {
    openContextMenuAtClient(event.clientX, event.clientY, pendingConnection)
    suppressNextClickClose()
  }

  dragState.value = null
  panState.value = null
  resizeState.value = null
  clearDraftConnection()
}

function handleWindowPointerCancel() {
  dragState.value = null
  panState.value = null
  resizeState.value = null
  clearDraftConnection()
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

function setViewportZoomAtClient(clientX: number, clientY: number, nextZoom: number) {
  viewport.value = viewportForClientZoom(
    clientX,
    clientY,
    viewportRef.value?.getBoundingClientRect(),
    viewport.value,
    nextZoom,
  )
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

function removeNode(nodeId: string) {
  cleanupMeasuredNodeElement(nodeId)
  removeDocumentNode(nodeId)
}

function handleNodeImageLoad(node: CanvasNode, event: Event) {
  if (event.currentTarget instanceof HTMLImageElement) {
    updateNodeImageDimensions(node, event.currentTarget)
  }
}

function galleryParamItems(image: GeneratedImage) {
  return buildGalleryParamItems(image, {
    aspectRatioOptions,
    resolutionOptions,
    qualityOptions,
  } as any)
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

function viewerDownloadKey() {
  return imageViewerDownloadKey(imageViewer.value)
}

function isGalleryImageDownloading(image: GeneratedImage) {
  return isDownloadingImage(imageDownloadKey(image, galleryActionScope.value))
}

function handleGalleryUseImage(image: GeneratedImage) {
  void useHistoryImage(image, galleryActionScope.value)
}

function handleGalleryPreloadDownload(image: GeneratedImage) {
  preloadGeneratedImageDownload(image, galleryActionScope.value)
}

function handleGalleryDownload(image: GeneratedImage) {
  downloadGeneratedImage(image, galleryActionScope.value)
}

function handleGallerySendToChat(image: GeneratedImage) {
  void sendHistoryImageToChat(image, galleryActionScope.value)
}

function preloadGeneratedImageDownload(image: GeneratedImage, scope: ImageHistoryScope = galleryActionScope.value) {
  preloadTarget(generatedImageTarget(image, scope))
}

function preloadNodeImageDownload(node: CanvasNode) {
  preloadTarget(nodeTarget(node))
}

function preloadViewerImageDownload() {
  preloadTarget(viewerTarget(imageViewer.value))
}

function downloadGeneratedImage(image: GeneratedImage, scope: ImageHistoryScope = 'mine') {
  void downloadTarget(generatedImageTarget(image, scope))
}

async function sendHistoryImageToChat(image: GeneratedImage, scope: ImageHistoryScope = 'mine') {
  const detail = await resolveImageDetail(image, scope)
  const imageUrl = previewImageUrl(detail)
  if (!imageUrl) {
    error.value = '预览图加载失败，请稍后重试。'
    return
  }
  emit('sendToChat', imageUrl)
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

function imageAltText(node: CanvasNode) {
  return node.content.trim() || node.sourcePrompt || node.title
}

function imageOutputMeta(node: CanvasNode) {
  return node.fileName || 'WEBP'
}

function historyImageForNode(node: ImageDownloadNode) {
  if (!node.sourceImageId) return null
  const sourceImages = node.sourceHistoryScope === 'public'
    ? publicGalleryImages.value
    : generatedImages.value
  return sourceImages.find(image => image.id === node.sourceImageId) ?? null
}

function handleDownload(node: CanvasNode) {
  if (!node.imageUrl) return
  void downloadTarget(nodeTarget(node))
}

async function sendNodeImageToChat(node: CanvasNode) {
  if (!node.imageUrl) return
  const imageUrl = await resolveNodePreviewImageUrl(node)
  if (!imageUrl) {
    error.value = '预览图加载失败，请稍后重试。'
    return
  }
  emit('sendToChat', imageUrl)
}

function downloadImageViewerImage() {
  void downloadTarget(viewerTarget(imageViewer.value))
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
      // zoomImageViewer(0.12)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      // zoomImageViewer(-0.12)
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
  const boxes = nodes.value.map((node) => {
    const size = getRenderedNodeSize(node)
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      width: size.width,
      height: size.height,
    }
  })
  viewport.value = fitViewportToNodeBoxes(
    viewportRef.value?.getBoundingClientRect(),
    boxes,
    selectedNodeId.value,
  )
}

function clearCanvas() {
  nodes.value.forEach(node => cleanupMeasuredNodeElement(node.id))
  clearCanvasDocument()
}

function hasIncoming(node: CanvasNode, handle: InputHandle) {
  return incomingConnections(node.id, handle).length > 0
}

function connectedHandlesForNode(node: CanvasNode) {
  return {
    'image-in': hasIncoming(node, 'image-in'),
    'prompt-in': hasIncoming(node, 'prompt-in'),
    'reference-in': hasIncoming(node, 'reference-in'),
  }
}

onMounted(() => {
  void ensureAppConfig()

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
  clearMeasuredNodes()
  if (suppressClickTimer !== null) {
    window.clearTimeout(suppressClickTimer)
    suppressClickTimer = null
  }
})
</script>

<template>
  <div class="image-canvas">
    <template v-if="currentImageMode === 'imagio'">
      <ImagioSidebar
        :image-mode="currentImageMode"
        :history-images="historyImages"
        :has-generated-images="Boolean(generatedImages.length)"
        @select-image-mode="handleImageModeChange"
        @use-history-image="useHistoryImage"
        @clear-history="clearHistory"
      />
    </template>
    <template v-else>
      <ImageCanvasSidebar
        :active-workspace="activeWorkspace"
        :image-mode="currentImageMode"
        :mini-map-layout="miniMapLayout"
        :history-images="historyImages"
        :has-generated-images="Boolean(generatedImages.length)"
        @select-workspace="selectWorkspace"
        @select-image-mode="handleImageModeChange"
        @create-node="createNodeNearCenter"
        @use-history-image="useHistoryImage"
        @clear-history="clearHistory"
      />
    </template>

    <section v-if="activeWorkspace === 'canvas'" class="canvas-stage">
      <template v-if="currentImageMode === 'imagio'">
        <ImagioView
          :can-select-generation-count="props.canSelectGenerationCount"
        />
      </template>
      <template v-else>
        <ImageCanvasStageActions
          :zoom-label="viewportZoomLabel"
          @create-node="createNodeNearCenter"
          @fit-view="fitView"
          @import-canvas="importCanvasFromFile"
          @export-canvas="exportCanvasToFile"
          @clear-canvas="clearCanvas"
        />

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

          <ImageCanvasNode
            v-for="node in nodes"
            :key="node.id"
            :ref="measuredNodeRef(node.id)"
            :node="node"
            :selected="selectedNodeId === node.id"
            :node-style="nodeStyle(node)"
            :mention-state="mentionState"
            :mention-options="mentionOptions"
            :text-mention-open="isMentionIndexOpen(node, 'text')"
            :generation-mention-open="isMentionIndexOpen(node, 'generation')"
            :connected-handles="connectedHandlesForNode(node)"
            :is-generated-image-node="isGeneratedImageNode(node)"
            :image-alt="imageAltText(node)"
            :image-output-meta="imageOutputMeta(node)"
            :is-downloading="isDownloadingImage(nodeDownloadKey(node))"
            :has-prompt-link="hasPromptLink(node)"
            :generation-prompt-value="getGenerationPromptValue(node)"
            :referenced-image-nodes="referencedImageNodes(node)"
            :can-select-generation-count="Boolean(props.canSelectGenerationCount)"
            :generation-count="1"
            :generation-count-options="generationCountOptions"
            :resolution-options="resolutionOptions"
            :aspect-ratio-options="aspectRatioOptions"
            :quality-options="qualityOptions"
            :is-generating="isGenerating"
            :resolve-mention-token="imageNodeForRichToken"
            @select="selectNode"
            @open-context-menu="openNodeContextMenu"
            @start-drag="startNodeDrag"
            @remove="removeNode"
            @rich-input="updateRichEditorContent"
            @mention-keydown="handleMentionKeydown"
            @mention-caret="updateMentionStateFromEditor"
            @insert-mention="insertMention"
            @start-connection="startConnection"
            @finish-connection="finishConnection"
            @image-load="handleNodeImageLoad"
            @open-image-viewer="openImageViewer"
            @update-content="updateNodeContent"
            @create-continuation="createContinuation"
            @download="handleDownload"
            @send-to-chat="sendNodeImageToChat"
            @update-resolution="updateNodeResolution"
            @update-aspect-ratio="updateNodeAspectRatio"
            @update-quality="updateNodeQuality"
            @update-generation-count="setGenerationCount"
            @generate="generateFromNode"
            @start-resize="startNodeResize"
            @reset-scale="resetNodeScale"
          />
        </div>

        <ImageCanvasContextMenu
          v-if="contextMenu.visible"
          :x="contextMenu.x"
          :y="contextMenu.y"
          :has-node="Boolean(contextMenuNode)"
          @rename="renameContextNode"
          @duplicate="duplicateContextNode"
          @delete="deleteContextNode"
          @create-node="createNodeAtMenu"
        />
      </div>

      <ImageCanvasBottomToolbar
        :zoom="viewport.zoom"
        :min-zoom="MIN_VIEWPORT_ZOOM"
        :max-zoom="MAX_VIEWPORT_ZOOM"
        :zoom-label="viewportZoomLabel"
        @update:zoom="viewport.zoom = $event"
      />

      <div v-if="error" class="global-error">{{ error }}</div>
      </template>
    </section>

    <ImageCanvasGalleryStage
      v-else
      v-model:query="galleryQuery"
      v-model:filter="galleryFilter"
      :images="visibleGalleryImages"
      :filtered-count="filteredGalleryImages.length"
      :source-count="gallerySourceImages.length"
      :filter-options="galleryFilterOptions"
      :has-filter="galleryHasFilter"
      :is-public-filter="isPublicGalleryFilter"
      :gallery-loaded="galleryLoaded"
      :is-loading="isGalleryLoading"
      :is-loading-more="isGalleryLoadingMore"
      :error="error"
      :resolution-options="resolutionOptions"
      :quality-options="qualityOptions"
      :is-image-downloading="isGalleryImageDownloading"
      @load-more="handleLoadMoreGallery"
      @view="openGalleryDetail"
      @use-image="handleGalleryUseImage"
      @preload-download="handleGalleryPreloadDownload"
      @download="handleGalleryDownload"
      @send-to-chat="handleGallerySendToChat"
    />

    <ImageGalleryDetailModal
      v-if="galleryDetail"
      :image-url="galleryDetailImageUrl(galleryDetail)"
      :image-alt="galleryPrompt(galleryDetail)"
      :image-title="galleryFileName(galleryDetail).replace(/\.[a-z0-9]{2,5}$/i, '')"
      :prompt="galleryPrompt(galleryDetail)"
      :reference-count="galleryReferenceCount(galleryDetail)"
      :references="galleryReferences(galleryDetail)"
      :params="galleryParamItems(galleryDetail)"
      :is-loading-preview="isGalleryDetailLoadingPreview"
      :is-downloading="isDownloadingImage(imageDownloadKey(galleryDetail, galleryDetailScope))"
      @close="closeGalleryDetail"
      @open-viewer="openGalleryDetailViewer"
      @use-image="useGalleryDetailImage"
      @preload-download="preloadGeneratedImageDownload(galleryDetail, galleryDetailScope)"
      @download="downloadGalleryDetail"
      @send-to-chat="sendGalleryDetailToChat"
    />

    <ImageViewerModal
      v-if="imageViewer"
      :viewer="imageViewer"
      :is-downloading="isDownloadingImage(viewerDownloadKey())"
      @close="closeImageViewer"
      @zoom="zoomImageViewer"
      @reset-zoom="resetImageViewerZoom"
      @preload-download="preloadViewerImageDownload"
      @download="downloadImageViewerImage"
    />
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

.canvas-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
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

.canvas-viewport {
  touch-action: none;
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

@media (max-width: 760px) {
  .image-canvas {
    flex-direction: column;
  }

  .canvas-stage {
    min-height: 0;
  }
}
</style>
