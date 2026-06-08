import type {
  CanvasHandle,
  CanvasNodeType,
  CanvasRuntimeNode,
  InputHandle,
  OutputHandle,
} from './canvas-document'
import type { GeneratedImage, ImageGenRequest } from '../types/image'
import type { ImageHistoryScope } from '../composables/useImageGen'

export type { CanvasHandle, CanvasNodeType, InputHandle, OutputHandle }

export type HandleRole = 'input' | 'output'
export type NodeSize = NonNullable<ImageGenRequest['size']>
export type NodeAspectRatio = NonNullable<ImageGenRequest['aspectRatio']>
export type NodeResolution = NonNullable<ImageGenRequest['resolution']>
export type NodeQuality = NonNullable<ImageGenRequest['quality']>
export type NodeGenerationCount = NonNullable<ImageGenRequest['count']>
export type MentionField = 'text' | 'generation'
export type WorkspaceMode = 'canvas' | 'gallery'
export type GalleryFilter = 'mine' | 'references' | 'latest'
export type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface CanvasNode extends CanvasRuntimeNode {
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
  count?: NodeGenerationCount
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  storagePath?: string
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

export interface Connection {
  id: string
  fromNodeId: string
  fromHandle: OutputHandle
  toNodeId: string
  toHandle: InputHandle
  managedByMention?: boolean
}

export interface DraftConnection {
  nodeId: string
  handle: CanvasHandle
  role: HandleRole
  cursorX: number
  cursorY: number
  startClientX: number
  startClientY: number
}

export interface PendingMenuConnection {
  nodeId: string
  handle: CanvasHandle
  role: HandleRole
}

export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  canvasX: number
  canvasY: number
  pendingConnection: PendingMenuConnection | null
  targetNodeId: string | null
}

export interface DragState {
  nodeId: string
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

export interface PanState {
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

export interface ResizeState {
  nodeId: string
  corner: ResizeCorner
  startClientX: number
  startClientY: number
  startScale: number
  startX: number
  startY: number
}

export interface MentionState {
  nodeId: string
  field: MentionField
  query: string
  start: number
  end: number
  activeIndex: number
}

export interface ImageViewerState {
  imageUrl: string
  title: string
  caption: string
  zoom: number
  loadingPreview?: boolean
  sourceImageId?: string
  sourceScope?: ImageHistoryScope
}

export interface GalleryParam {
  label: string
  value: string
}

export interface NodeDimensions {
  width: number
  height: number
}

export type GalleryReference = NonNullable<GeneratedImage['references']>[number]

export const NODE_SIZE: Record<CanvasNodeType, NodeDimensions> = {
  text: { width: 270, height: 156 },
  image: { width: 232, height: 326 },
  generation: { width: 334, height: 700 },
}

export const PLANE_SIZE = { width: 3600, height: 2400 }
export const MINI_MAP_VIEW = { width: 100, height: 54, padding: 5 }
export const MENU_WIDTH = 176
export const MENU_HEIGHT = 150
export const MIN_NODE_SCALE = 0.72
export const MAX_NODE_SCALE = 2.4
export const MIN_VIEWPORT_ZOOM = 0.42
export const MAX_VIEWPORT_ZOOM = 1.4
export const GALLERY_PAGE_SIZE = 12
export const GALLERY_AUTO_LOAD_PROGRESS = 0.5
export const REFERENCE_IMAGE_MAX_EDGE = 2048
export const REFERENCE_IMAGE_WEBP_QUALITY = 0.86
export const TEXT_NODE_CONTENT_SCALE_FACTOR = 0.5
export const MINI_MAP_WORLD_PADDING = 96
export const IMAGE_PREVIEW_HORIZONTAL_INSET = 20
export const IMAGE_PREVIEW_EMPTY_HEIGHT = 136
export const CANVAS_EXPORT_VERSION = 1
export const CANVAS_TITLE = 'Imagio canvas'
export const CANVAS_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024
