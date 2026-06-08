import {
  MAX_VIEWPORT_ZOOM,
  MINI_MAP_VIEW,
  MINI_MAP_WORLD_PADDING,
  MIN_VIEWPORT_ZOOM,
  NODE_SIZE,
  PLANE_SIZE,
  type CanvasNodeType,
} from './image-canvas-model'
import { clamp } from './image-canvas-utils'

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CanvasBox {
  x: number
  y: number
  width: number
  height: number
}

export interface MiniMapNodeInput extends CanvasBox {
  id: string
  type: CanvasNodeType
  selected: boolean
}

export interface MiniMapConnectionInput {
  id: string
  start: CanvasPoint
  end: CanvasPoint
}

export interface FitViewNodeBox extends CanvasBox {
  id: string
}

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = { x: -120, y: -40, zoom: 1 }

export function canvasPlaneStyle(viewport: CanvasViewport) {
  return {
    width: `${PLANE_SIZE.width}px`,
    height: `${PLANE_SIZE.height}px`,
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
  }
}

export function canvasPointFromClientPoint(
  clientX: number,
  clientY: number,
  rect: CanvasRect | null | undefined,
  viewport: CanvasViewport,
) {
  if (!rect) return { x: 0, y: 0 }

  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom,
  }
}

export function visibleCanvasCenterClientPoint(rect: CanvasRect | null | undefined) {
  if (!rect) return null

  const isMobile = rect.width <= 760
  const topInset = isMobile ? 142 : 0
  const bottomInset = isMobile ? 112 : 0
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + topInset + (rect.height - topInset - bottomInset) / 2,
  }
}

export function nodePositionNearVisibleCenter(
  type: CanvasNodeType,
  rect: CanvasRect | null | undefined,
  viewport: CanvasViewport,
  nodeCount: number,
) {
  const center = visibleCanvasCenterClientPoint(rect)
  if (!center) return null

  const point = canvasPointFromClientPoint(center.x, center.y, rect, viewport)
  const size = NODE_SIZE[type]
  const offset = nodeCount * 18
  return {
    x: point.x - size.width / 2 + offset,
    y: point.y - Math.min(size.height / 2, 180) + offset,
  }
}

export function viewportForClientZoom(
  clientX: number,
  clientY: number,
  rect: CanvasRect | null | undefined,
  viewport: CanvasViewport,
  nextZoom: number,
) {
  const point = canvasPointFromClientPoint(clientX, clientY, rect, viewport)
  return {
    x: clientX - (rect?.left ?? 0) - point.x * nextZoom,
    y: clientY - (rect?.top ?? 0) - point.y * nextZoom,
    zoom: nextZoom,
  }
}

export function normalizedWheelValue(value: number, deltaMode: number) {
  if (deltaMode === DOM_DELTA_LINE) return value * 16
  if (deltaMode === DOM_DELTA_PAGE) return value * 120
  return value
}

export function normalizedWheelDelta(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>) {
  return normalizedWheelValue(event.deltaY, event.deltaMode)
}

export function buildMiniMapLayout(options: {
  nodes: MiniMapNodeInput[]
  connections: MiniMapConnectionInput[]
  viewport: CanvasViewport
  viewportRect?: Pick<CanvasRect, 'width' | 'height'> | null
}) {
  const viewportBox = options.viewportRect
    ? {
      x: -options.viewport.x / options.viewport.zoom,
      y: -options.viewport.y / options.viewport.zoom,
      width: options.viewportRect.width / options.viewport.zoom,
      height: options.viewportRect.height / options.viewport.zoom,
    }
    : null
  const worldBoxes = [
    ...options.nodes,
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
  const mapBox = (box: CanvasBox) => {
    const point = mapPoint(box.x, box.y)
    return {
      x: point.x,
      y: point.y,
      width: Math.max(3, box.width * miniScale),
      height: Math.max(3, box.height * miniScale),
    }
  }

  return {
    nodes: options.nodes.map((item) => {
      const point = mapPoint(item.x, item.y)
      return {
        id: item.id,
        type: item.type,
        selected: item.selected,
        x: point.x,
        y: point.y,
        width: Math.max(2.6, item.width * miniScale),
        height: Math.max(2.6, item.height * miniScale),
      }
    }),
    connections: options.connections.map((connection) => {
      const miniStart = mapPoint(connection.start.x, connection.start.y)
      const miniEnd = mapPoint(connection.end.x, connection.end.y)
      const distance = Math.max(8, Math.abs(miniEnd.x - miniStart.x) * 0.42)
      return {
        id: connection.id,
        d: `M ${miniStart.x} ${miniStart.y} C ${miniStart.x + distance} ${miniStart.y}, ${miniEnd.x - distance} ${miniEnd.y}, ${miniEnd.x} ${miniEnd.y}`,
      }
    }),
    viewport: viewportBox ? mapBox(viewportBox) : null,
  }
}

export function fitViewportToNodeBoxes(
  rect: Pick<CanvasRect, 'width' | 'height'> | null | undefined,
  boxes: FitViewNodeBox[],
  selectedNodeId: string | null,
) {
  if (!rect || !boxes.length) return { ...DEFAULT_CANVAS_VIEWPORT }

  const isMobile = rect.width <= 760
  const selectedBoxes = isMobile && selectedNodeId
    ? boxes.filter(box => box.id === selectedNodeId)
    : []
  const targetBoxes = selectedBoxes.length ? selectedBoxes : boxes
  const minX = Math.min(...targetBoxes.map(item => item.x))
  const minY = Math.min(...targetBoxes.map(item => item.y))
  const maxX = Math.max(...targetBoxes.map(item => item.x + item.width))
  const maxY = Math.max(...targetBoxes.map(item => item.y + item.height))
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

  return {
    x: padding + (availableWidth - contentWidth * nextZoom) / 2 - minX * nextZoom,
    y: topInset + padding + (availableHeight - contentHeight * nextZoom) / 2 - minY * nextZoom,
    zoom: nextZoom,
  }
}
