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
export const CANVAS_WORKSPACE_STATE_KEY = 'canvas-workspace-state'
export const CANVAS_WORKSPACES_KEY = 'canvas-workspaces'
export const CANVAS_ACTIVE_WORKSPACE_KEY = 'canvas-active-workspace'
export const CANVAS_WORKSPACE_CACHE_KEY = 'canvas-workspace-snapshots'

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

export interface CanvasWorkspaceState {
  workspaces: CanvasWorkspace[]
  activeWorkspaceId: string
  snapshots: Map<string, CanvasWorkspaceSnapshot>
}

interface CanvasWorkspaceStateEnvelope extends CanvasWorkspaceCacheEnvelope {
  workspaces: CanvasWorkspace[]
  activeWorkspaceId: string
}

export interface CanvasWorkspaceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
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

function serializeSnapshotRecords(
  snapshots: ReadonlyMap<string, CanvasWorkspaceSnapshot>,
): Record<string, SerializedCanvasWorkspaceSnapshot> {
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
  return serialized
}

function parseSnapshotRecords(
  snapshots: Record<string, SerializedCanvasWorkspaceSnapshot> | undefined,
): Map<string, CanvasWorkspaceSnapshot> {
  const restored = new Map<string, CanvasWorkspaceSnapshot>()
  if (!snapshots || typeof snapshots !== 'object') return restored

  for (const [workspaceId, snapshot] of Object.entries(snapshots)) {
    if (!workspaceId || !snapshot || typeof snapshot !== 'object') continue
    const normalized = normalizeSnapshot(snapshot)
    if (normalized) restored.set(workspaceId, normalized)
  }
  return restored
}

export function isCanvasWorkspace(value: unknown): value is CanvasWorkspace {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || !('name' in value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string'
}

function parseCanvasWorkspaces(raw: string | null): CanvasWorkspace[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isCanvasWorkspace) : []
  } catch {
    return []
  }
}

export function serializeCanvasWorkspaceSnapshots(
  snapshots: ReadonlyMap<string, CanvasWorkspaceSnapshot>,
): string {
  const envelope: CanvasWorkspaceCacheEnvelope = {
    version: CANVAS_WORKSPACE_CACHE_VERSION,
    snapshots: serializeSnapshotRecords(snapshots),
  }
  return JSON.stringify(envelope)
}

export function parseCanvasWorkspaceSnapshots(raw: string | null): Map<string, CanvasWorkspaceSnapshot> {
  const snapshots = new Map<string, CanvasWorkspaceSnapshot>()
  if (!raw) return snapshots

  try {
    const envelope = JSON.parse(raw) as Partial<CanvasWorkspaceCacheEnvelope>
    if (envelope.version !== CANVAS_WORKSPACE_CACHE_VERSION || !envelope.snapshots) return snapshots

    return parseSnapshotRecords(envelope.snapshots)
  } catch {
    return new Map()
  }
}

export function serializeCanvasWorkspaceState(state: CanvasWorkspaceState): string {
  const envelope: CanvasWorkspaceStateEnvelope = {
    version: CANVAS_WORKSPACE_CACHE_VERSION,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    snapshots: serializeSnapshotRecords(state.snapshots),
  }
  return JSON.stringify(envelope)
}

export function parseCanvasWorkspaceState(raw: string | null): CanvasWorkspaceState | null {
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as Partial<CanvasWorkspaceStateEnvelope>
    if (
      envelope.version !== CANVAS_WORKSPACE_CACHE_VERSION
      || !Array.isArray(envelope.workspaces)
      || typeof envelope.activeWorkspaceId !== 'string'
    ) {
      return null
    }
    const workspaces = envelope.workspaces.filter(isCanvasWorkspace)
    if (workspaces.length === 0) return null
    const activeWorkspaceId = workspaces.some(workspace => workspace.id === envelope.activeWorkspaceId)
      ? envelope.activeWorkspaceId
      : workspaces[0].id
    return {
      workspaces,
      activeWorkspaceId,
      snapshots: parseSnapshotRecords(envelope.snapshots),
    }
  } catch {
    return null
  }
}

export function persistCanvasWorkspaceState(
  storage: CanvasWorkspaceStorage,
  state: CanvasWorkspaceState,
): void {
  storage.setItem(CANVAS_WORKSPACE_STATE_KEY, serializeCanvasWorkspaceState(state))
}

export function loadCanvasWorkspaceState(storage: CanvasWorkspaceStorage): CanvasWorkspaceState | null {
  const current = parseCanvasWorkspaceState(storage.getItem(CANVAS_WORKSPACE_STATE_KEY))
  if (current) return current

  const workspaces = parseCanvasWorkspaces(storage.getItem(CANVAS_WORKSPACES_KEY))
  if (workspaces.length === 0) return null
  const storedActiveId = storage.getItem(CANVAS_ACTIVE_WORKSPACE_KEY)
  const activeWorkspaceId = storedActiveId && workspaces.some(workspace => workspace.id === storedActiveId)
    ? storedActiveId
    : workspaces[0].id
  return {
    workspaces,
    activeWorkspaceId,
    snapshots: parseCanvasWorkspaceSnapshots(storage.getItem(CANVAS_WORKSPACE_CACHE_KEY)),
  }
}
