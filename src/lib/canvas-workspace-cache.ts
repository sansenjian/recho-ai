import {
  buildCanvasExportDocument,
  normalizeCanvasImport,
  parseCanvasExportDocument,
  type CanvasViewportState,
} from './canvas-document'
import {
  MAX_NODE_SCALE,
  MAX_VIEWPORT_ZOOM,
  MIN_NODE_SCALE,
  MIN_VIEWPORT_ZOOM,
  type CanvasNode,
  type Connection,
} from './image-canvas-model'
import type { CanvasDocumentState } from '../composables/useImageCanvasDocument'

export const CANVAS_WORKSPACE_CACHE_VERSION = 1

export interface CanvasWorkspace {
  id: string
  name: string
}

export interface CanvasWorkspaceSnapshot {
  document: CanvasDocumentState
  viewport: CanvasViewportState
}

interface SerializedCanvasWorkspaceSnapshot {
  document: ReturnType<typeof buildCanvasExportDocument>
  selectedNodeId: string | null
  viewport: CanvasViewportState
}

interface CanvasWorkspaceCacheEnvelope {
  version: typeof CANVAS_WORKSPACE_CACHE_VERSION
  snapshots: Record<string, SerializedCanvasWorkspaceSnapshot>
}

function cloneViewport(viewport: CanvasViewportState): CanvasViewportState {
  return { ...viewport }
}

function normalizeCachedViewport(viewport: CanvasViewportState | undefined): CanvasViewportState {
  const x = viewport?.x
  const y = viewport?.y
  const zoom = viewport?.zoom
  return {
    x: typeof x === 'number' && Number.isFinite(x) ? x : -120,
    y: typeof y === 'number' && Number.isFinite(y) ? y : -40,
    zoom: Math.min(
      MAX_VIEWPORT_ZOOM,
      Math.max(
        MIN_VIEWPORT_ZOOM,
        typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : 1,
      ),
    ),
  }
}

function normalizeSnapshot(
  snapshot: SerializedCanvasWorkspaceSnapshot,
): CanvasWorkspaceSnapshot | null {
  try {
    const parsed = parseCanvasExportDocument(snapshot.document)
    if (parsed.canvas.nodes.length === 0) {
      return {
        document: {
          nodes: [],
          connections: [],
          selectedNodeId: null,
        },
        viewport: normalizeCachedViewport(parsed.canvas.viewport),
      }
    }

    let connectionIndex = 0
    const normalized = normalizeCanvasImport(parsed, {
      mode: 'replace',
      createConnectionId: () => parsed.canvas.connections[connectionIndex++]?.id ?? `cached_connection_${connectionIndex}`,
      minNodeScale: MIN_NODE_SCALE,
      maxNodeScale: MAX_NODE_SCALE,
      minViewportZoom: MIN_VIEWPORT_ZOOM,
      maxViewportZoom: MAX_VIEWPORT_ZOOM,
    })
    const nodeIds = new Set(normalized.nodes.map(node => node.id))
    return {
      document: {
        nodes: normalized.nodes as CanvasNode[],
        connections: normalized.connections as Connection[],
        selectedNodeId: snapshot.selectedNodeId && nodeIds.has(snapshot.selectedNodeId)
          ? snapshot.selectedNodeId
          : null,
      },
      viewport: cloneViewport(normalized.viewport),
    }
  } catch {
    return null
  }
}

export function serializeCanvasWorkspaceSnapshots(
  snapshots: ReadonlyMap<string, CanvasWorkspaceSnapshot>,
): string {
  const serialized: Record<string, SerializedCanvasWorkspaceSnapshot> = {}
  for (const [workspaceId, snapshot] of snapshots) {
    serialized[workspaceId] = {
      document: buildCanvasExportDocument({
        canvasId: `workspace_${workspaceId}`,
        title: 'Cached canvas workspace',
        viewport: snapshot.viewport,
        nodes: snapshot.document.nodes,
        connections: snapshot.document.connections,
      }),
      selectedNodeId: snapshot.document.selectedNodeId,
      viewport: cloneViewport(snapshot.viewport),
    }
  }

  const envelope: CanvasWorkspaceCacheEnvelope = {
    version: CANVAS_WORKSPACE_CACHE_VERSION,
    snapshots: serialized,
  }
  return JSON.stringify(envelope)
}

export function parseCanvasWorkspaceSnapshots(raw: string | null): Map<string, CanvasWorkspaceSnapshot> {
  const snapshots = new Map<string, CanvasWorkspaceSnapshot>()
  if (!raw) return snapshots

  try {
    const envelope = JSON.parse(raw) as Partial<CanvasWorkspaceCacheEnvelope>
    if (envelope.version !== CANVAS_WORKSPACE_CACHE_VERSION || !envelope.snapshots) return snapshots

    for (const [workspaceId, snapshot] of Object.entries(envelope.snapshots)) {
      if (!workspaceId || !snapshot || typeof snapshot !== 'object') continue
      const normalized = normalizeSnapshot(snapshot)
      if (normalized) snapshots.set(workspaceId, normalized)
    }
  } catch {
    return new Map()
  }

  return snapshots
}
