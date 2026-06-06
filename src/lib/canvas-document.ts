import type { ImageAspectRatio, ImageHistoryScope, ImageQuality, ImageResolution, ImageSize } from '../types/image'

export type CanvasNodeType = 'text' | 'image' | 'generation'
export type OutputHandle = 'text-out' | 'image-out' | 'generation-out'
export type InputHandle = 'prompt-in' | 'reference-in' | 'image-in'
export type CanvasHandle = OutputHandle | InputHandle
export interface CanvasViewportState {
  x: number
  y: number
  zoom: number
}

export interface CanvasDocumentNode {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  title: string
  content: string
  size: ImageSize
  aspectRatio: ImageAspectRatio
  resolution: ImageResolution
  quality: ImageQuality
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  fileName?: string
  sourceImageId?: string
  sourceHistoryScope?: ImageHistoryScope
  sourcePrompt?: string
  scale?: number
  mentions?: string[]
}

export interface CanvasDocumentConnection {
  id: string
  fromNodeId: string
  fromHandle: OutputHandle
  toNodeId: string
  toHandle: InputHandle
  managedByMention?: boolean
}

export interface CanvasExportDocument {
  schema: 'recho.canvas'
  version: 1
  exportedAt: string
  canvas: {
    id: string
    title: string
    version: number
    viewport: CanvasViewportState
    nodes: CanvasDocumentNode[]
    connections: CanvasDocumentConnection[]
  }
  assets: {
    mode: 'references-only'
    images: Array<{
      nodeId: string
      url?: string
      fileName?: string
      sourceImageId?: string
      sourceHistoryScope?: ImageHistoryScope
    }>
  }
}

export interface CanvasDocumentNodeRuntimeFields {
  loading?: boolean
  status?: string | null
  error?: string | null
}

export type CanvasRuntimeNode = CanvasDocumentNode & CanvasDocumentNodeRuntimeFields

export interface BuildCanvasExportOptions {
  canvasId: string
  title: string
  version?: 1
  viewport: CanvasViewportState
  nodes: CanvasRuntimeNode[]
  connections: CanvasDocumentConnection[]
  exportedAt?: string
}

export interface NormalizeCanvasDocumentOptions {
  existingNodeIds?: Iterable<string>
  mode?: 'append' | 'replace'
  createNodeId?: (type: CanvasNodeType) => string
  createConnectionId?: () => string
  minNodeScale?: number
  maxNodeScale?: number
  minViewportZoom?: number
  maxViewportZoom?: number
}

export interface NormalizedCanvasDocument {
  nodes: CanvasRuntimeNode[]
  connections: CanvasDocumentConnection[]
  viewport: CanvasViewportState
}

export const CANVAS_SCHEMA = 'recho.canvas'
export const CANVAS_EXPORT_VERSION = 1

const DEFAULT_VIEWPORT: CanvasViewportState = { x: -120, y: -40, zoom: 1 }
const nodeTypes = new Set<CanvasNodeType>(['text', 'image', 'generation'])

export function isEmbeddedImageUrl(value: string | undefined) {
  return Boolean(value && (/^(data|blob):/i.test(value)))
}

export function exportableImageUrl(value: string | undefined) {
  return isEmbeddedImageUrl(value) ? undefined : value
}

export function isOutputHandle(handle: unknown): handle is OutputHandle {
  return handle === 'text-out' || handle === 'image-out' || handle === 'generation-out'
}

export function isInputHandle(handle: unknown): handle is InputHandle {
  return handle === 'prompt-in' || handle === 'reference-in' || handle === 'image-in'
}

export function isValidCanvasConnection(
  nodes: Array<Pick<CanvasDocumentNode, 'id' | 'type'>>,
  fromNodeId: string,
  fromHandle: OutputHandle,
  toNodeId: string,
  toHandle: InputHandle,
) {
  if (fromNodeId === toNodeId) return false
  const source = nodes.find(node => node.id === fromNodeId)
  const target = nodes.find(node => node.id === toNodeId)
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

export function buildCanvasExportDocument(options: BuildCanvasExportOptions): CanvasExportDocument {
  const version = options.version ?? CANVAS_EXPORT_VERSION
  const exportedNodes = options.nodes.map(serializableCanvasNode)
  return {
    schema: CANVAS_SCHEMA,
    version,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    canvas: {
      id: options.canvasId,
      title: options.title,
      version,
      viewport: { ...options.viewport },
      nodes: exportedNodes,
      connections: options.connections.map(conn => ({ ...conn })),
    },
    assets: {
      mode: 'references-only',
      images: exportedNodes
        .filter(node => node.type === 'image' && (node.imageUrl || node.fileName || node.sourceImageId))
        .map(node => ({
          nodeId: node.id,
          ...(node.imageUrl ? { url: node.imageUrl } : {}),
          ...(node.fileName ? { fileName: node.fileName } : {}),
          ...(node.sourceImageId ? { sourceImageId: node.sourceImageId } : {}),
          ...(node.sourceHistoryScope ? { sourceHistoryScope: node.sourceHistoryScope } : {}),
        })),
    },
  }
}

export function parseCanvasExportDocument(value: unknown): CanvasExportDocument {
  if (!isRecord(value) || value.schema !== CANVAS_SCHEMA) {
    throw new Error('不是有效的 Recho 画布文件')
  }
  if (value.version !== CANVAS_EXPORT_VERSION) {
    throw new Error('暂不支持该画布文件版本')
  }
  const canvas = value.canvas
  if (!isRecord(canvas) || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.connections)) {
    throw new Error('画布文件缺少节点或连线')
  }
  return value as unknown as CanvasExportDocument
}

export function normalizeCanvasImport(
  document: CanvasExportDocument,
  options: NormalizeCanvasDocumentOptions = {},
): NormalizedCanvasDocument {
  const mode = options.mode ?? 'append'
  const existingNodeIds = new Set(options.existingNodeIds ?? [])
  assertUniqueDocumentNodeIds(document.canvas.nodes)
  const idMap = new Map<string, string>()
  const nodes = document.canvas.nodes
    .map(node => normalizeImportedNode(node, idMap, existingNodeIds, mode, options))
    .filter((node): node is CanvasRuntimeNode => Boolean(node))
  const connections = normalizeImportedConnections(document.canvas.connections, idMap, nodes, options)

  if (!nodes.length) {
    throw new Error('画布文件没有可导入的节点')
  }

  return {
    nodes,
    connections,
    viewport: normalizeViewport(document.canvas.viewport, options),
  }
}

function assertUniqueDocumentNodeIds(nodes: CanvasDocumentNode[]) {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (!node?.id) continue
    if (ids.has(node.id)) {
      throw new Error('画布文件包含重复节点 ID')
    }
    ids.add(node.id)
  }
}

function serializableCanvasNode(node: CanvasRuntimeNode): CanvasDocumentNode {
  return {
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    title: node.title,
    content: node.content,
    size: node.size,
    aspectRatio: node.aspectRatio,
    resolution: node.resolution,
    quality: node.quality,
    ...(exportableImageUrl(node.imageUrl) ? { imageUrl: exportableImageUrl(node.imageUrl) } : {}),
    ...(typeof node.imageWidth === 'number' ? { imageWidth: node.imageWidth } : {}),
    ...(typeof node.imageHeight === 'number' ? { imageHeight: node.imageHeight } : {}),
    ...(node.fileName ? { fileName: node.fileName } : {}),
    ...(node.sourceImageId ? { sourceImageId: node.sourceImageId } : {}),
    ...(node.sourceHistoryScope ? { sourceHistoryScope: node.sourceHistoryScope } : {}),
    ...(typeof node.scale === 'number' ? { scale: node.scale } : {}),
    ...(node.mentions?.length ? { mentions: [...node.mentions] } : {}),
  }
}

function normalizeImportedNode(
  raw: CanvasDocumentNode,
  idMap: Map<string, string>,
  existingNodeIds: Set<string>,
  mode: 'append' | 'replace',
  options: NormalizeCanvasDocumentOptions,
): CanvasRuntimeNode | null {
  if (!raw?.id || !raw.type || !nodeTypes.has(raw.type)) return null
  const collides = mode === 'append' && existingNodeIds.has(raw.id)
  const id = collides ? options.createNodeId?.(raw.type) ?? `${raw.type}_${raw.id}` : raw.id
  idMap.set(raw.id, id)
  return {
    id,
    type: raw.type,
    x: Number.isFinite(raw.x) ? raw.x : 0,
    y: Number.isFinite(raw.y) ? raw.y : 0,
    title: String(raw.title || '节点').slice(0, 48),
    content: String(raw.content || ''),
    size: raw.size || 'auto',
    aspectRatio: raw.aspectRatio || 'auto',
    resolution: raw.resolution || 'auto',
    quality: raw.quality || 'auto',
    ...(exportableImageUrl(raw.imageUrl) ? { imageUrl: exportableImageUrl(raw.imageUrl) } : {}),
    ...(typeof raw.imageWidth === 'number' ? { imageWidth: raw.imageWidth } : {}),
    ...(typeof raw.imageHeight === 'number' ? { imageHeight: raw.imageHeight } : {}),
    ...(raw.fileName ? { fileName: String(raw.fileName) } : {}),
    ...(raw.sourceImageId ? { sourceImageId: String(raw.sourceImageId) } : {}),
    ...(raw.sourceHistoryScope === 'public' || raw.sourceHistoryScope === 'mine' ? { sourceHistoryScope: raw.sourceHistoryScope } : {}),
    ...(raw.sourcePrompt ? { sourcePrompt: String(raw.sourcePrompt) } : {}),
    ...(typeof raw.scale === 'number' ? { scale: clamp(raw.scale, options.minNodeScale ?? 0.72, options.maxNodeScale ?? 2.4) } : { scale: 1 }),
    ...(Array.isArray(raw.mentions) ? { mentions: raw.mentions.map(String) } : {}),
    loading: false,
    status: null,
    error: null,
  }
}

function normalizeImportedConnections(
  rawConnections: CanvasDocumentConnection[],
  idMap: Map<string, string>,
  importedNodes: CanvasRuntimeNode[],
  options: NormalizeCanvasDocumentOptions,
) {
  const importedNodeIds = new Set(importedNodes.map(node => node.id))
  return rawConnections
    .map((conn): CanvasDocumentConnection | null => {
      const fromNodeId = idMap.get(conn.fromNodeId)
      const toNodeId = idMap.get(conn.toNodeId)
      if (!fromNodeId || !toNodeId) return null
      if (!importedNodeIds.has(fromNodeId) || !importedNodeIds.has(toNodeId)) return null
      if (!isOutputHandle(conn.fromHandle) || !isInputHandle(conn.toHandle)) return null
      if (!isValidCanvasConnection(importedNodes, fromNodeId, conn.fromHandle, toNodeId, conn.toHandle)) return null
      return {
        id: options.createConnectionId?.() ?? `conn_${conn.id}`,
        fromNodeId,
        fromHandle: conn.fromHandle,
        toNodeId,
        toHandle: conn.toHandle,
        ...(conn.managedByMention ? { managedByMention: true } : {}),
      }
    })
    .filter((conn): conn is CanvasDocumentConnection => Boolean(conn))
}

function normalizeViewport(
  viewport: CanvasViewportState | undefined,
  options: NormalizeCanvasDocumentOptions,
): CanvasViewportState {
  const x = viewport?.x
  const y = viewport?.y
  const zoom = viewport?.zoom
  return {
    x: finiteNumber(x) ? x : DEFAULT_VIEWPORT.x,
    y: finiteNumber(y) ? y : DEFAULT_VIEWPORT.y,
    zoom: clamp(
      finiteNumber(zoom) ? zoom : DEFAULT_VIEWPORT.zoom,
      options.minViewportZoom ?? 0.42,
      options.maxViewportZoom ?? 1.4,
    ),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
