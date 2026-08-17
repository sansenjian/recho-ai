import { describe, expect, it } from 'vitest'
import {
  CANVAS_ACTIVE_WORKSPACE_KEY,
  CANVAS_WORKSPACES_KEY,
  CANVAS_WORKSPACE_CACHE_KEY,
  CANVAS_WORKSPACE_STATE_KEY,
  loadCanvasWorkspaceState,
  parseCanvasWorkspaceSnapshots,
  persistCanvasWorkspaceState,
  removeCanvasWorkspace,
  serializeCanvasWorkspaceSnapshots,
  type CanvasWorkspaceSnapshot,
} from '../src/lib/canvas-workspace-cache'

class MemoryStorage {
  readonly values = new Map<string, string>()
  failWrites = false

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('quota exceeded')
    this.values.set(key, value)
  }
}

describe('canvas workspace cache', () => {
  it('round-trips document state without caching embedded image bodies', () => {
    const snapshot: CanvasWorkspaceSnapshot = {
      document: {
        nodes: [
          {
            id: 'text_1',
            type: 'text',
            x: 10,
            y: 20,
            title: '文本',
            content: 'cached prompt',
            size: 'auto',
            aspectRatio: 'auto',
            resolution: 'auto',
            quality: 'auto',
          },
          {
            id: 'image_1',
            type: 'image',
            x: 420,
            y: 20,
            title: '图片1',
            content: '',
            size: 'auto',
            aspectRatio: 'auto',
            resolution: 'auto',
            quality: 'auto',
            imageUrl: 'data:image/png;base64,not-for-cache',
            sourceImageId: 'history_1',
          },
          {
            id: 'generation_1',
            type: 'generation',
            x: 700,
            y: 20,
            title: '图片生成',
            content: '',
            size: 'auto',
            aspectRatio: 'auto',
            resolution: 'auto',
            quality: 'auto',
            count: 1,
          },
        ],
        connections: [
          {
            id: 'connection_1',
            fromNodeId: 'image_1',
            fromHandle: 'image-out',
            toNodeId: 'generation_1',
            toHandle: 'reference-in',
          },
        ],
        selectedNodeId: 'text_1',
      },
      viewport: { x: 12, y: 18, zoom: 0.8 },
    }
    const snapshots = new Map([['workspace_1', snapshot]])

    const raw = serializeCanvasWorkspaceSnapshots(snapshots)
    const restored = parseCanvasWorkspaceSnapshots(raw).get('workspace_1')

    expect(raw).not.toContain('base64')
    expect(restored?.document.nodes[0]?.content).toBe('cached prompt')
    expect(restored?.document.nodes[1]?.imageUrl).toBeUndefined()
    expect(restored?.document.nodes[1]?.sourceImageId).toBe('history_1')
    expect(restored?.document.connections).toEqual([
      {
        id: 'connection_1',
        fromNodeId: 'image_1',
        fromHandle: 'image-out',
        toNodeId: 'generation_1',
        toHandle: 'reference-in',
      },
    ])
    expect(restored?.document.selectedNodeId).toBe('text_1')
    expect(restored?.viewport).toEqual({ x: 12, y: 18, zoom: 0.8 })
  })

  it('ignores malformed cache entries instead of breaking canvas startup', () => {
    const restored = parseCanvasWorkspaceSnapshots('{"version":1,"snapshots":{"broken":{}}}')
    expect(restored.size).toBe(0)
  })

  it('preserves an intentionally empty canvas across cache restoration', () => {
    const snapshot: CanvasWorkspaceSnapshot = {
      document: {
        nodes: [],
        connections: [],
        selectedNodeId: null,
      },
      viewport: { x: -80, y: 40, zoom: 1.1 },
    }

    const raw = serializeCanvasWorkspaceSnapshots(new Map([['empty_workspace', snapshot]]))
    const restored = parseCanvasWorkspaceSnapshots(raw).get('empty_workspace')

    expect(restored).toEqual(snapshot)
  })

  it('persists workspace metadata, active selection, and snapshots in one record', () => {
    const storage = new MemoryStorage()
    const snapshot: CanvasWorkspaceSnapshot = {
      document: {
        nodes: [],
        connections: [],
        selectedNodeId: null,
      },
      viewport: { x: 24, y: -12, zoom: 0.9 },
    }

    persistCanvasWorkspaceState(storage, {
      workspaces: [{ id: 'workspace_1', name: '画布 1' }],
      activeWorkspaceId: 'workspace_1',
      snapshots: new Map([['workspace_1', snapshot]]),
    })

    expect(storage.values.size).toBe(1)
    expect(storage.values.has(CANVAS_WORKSPACE_STATE_KEY)).toBe(true)
    expect(loadCanvasWorkspaceState(storage)).toEqual({
      workspaces: [{ id: 'workspace_1', name: '画布 1' }],
      activeWorkspaceId: 'workspace_1',
      snapshots: new Map([['workspace_1', snapshot]]),
    })
  })

  it('loads legacy workspace keys when the versioned state record is absent', () => {
    const storage = new MemoryStorage()
    const snapshot: CanvasWorkspaceSnapshot = {
      document: { nodes: [], connections: [], selectedNodeId: null },
      viewport: { x: -20, y: 8, zoom: 1.2 },
    }
    storage.values.set(CANVAS_WORKSPACES_KEY, JSON.stringify([
      { id: 'legacy_workspace', name: '旧画布' },
    ]))
    storage.values.set(CANVAS_ACTIVE_WORKSPACE_KEY, 'legacy_workspace')
    storage.values.set(
      CANVAS_WORKSPACE_CACHE_KEY,
      serializeCanvasWorkspaceSnapshots(new Map([['legacy_workspace', snapshot]])),
    )

    expect(loadCanvasWorkspaceState(storage)).toEqual({
      workspaces: [{ id: 'legacy_workspace', name: '旧画布' }],
      activeWorkspaceId: 'legacy_workspace',
      snapshots: new Map([['legacy_workspace', snapshot]]),
    })
  })

  it('keeps the previous complete record when an atomic persistence write fails', () => {
    const storage = new MemoryStorage()
    const previous: CanvasWorkspaceSnapshot = {
      document: { nodes: [], connections: [], selectedNodeId: null },
      viewport: { x: 1, y: 2, zoom: 1 },
    }
    persistCanvasWorkspaceState(storage, {
      workspaces: [{ id: 'workspace_1', name: '画布 1' }],
      activeWorkspaceId: 'workspace_1',
      snapshots: new Map([['workspace_1', previous]]),
    })

    storage.failWrites = true
    expect(() => persistCanvasWorkspaceState(storage, {
      workspaces: [{ id: 'workspace_2', name: '画布 2' }],
      activeWorkspaceId: 'workspace_2',
      snapshots: new Map(),
    })).toThrow('quota exceeded')

    expect(loadCanvasWorkspaceState(storage)).toEqual({
      workspaces: [{ id: 'workspace_1', name: '画布 1' }],
      activeWorkspaceId: 'workspace_1',
      snapshots: new Map([['workspace_1', previous]]),
    })
  })

  it('removes the active workspace and selects the adjacent cached workspace', () => {
    const emptySnapshot: CanvasWorkspaceSnapshot = {
      document: { nodes: [], connections: [], selectedNodeId: null },
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const state = {
      workspaces: [
        { id: 'workspace_1', name: '画布 1' },
        { id: 'workspace_2', name: '画布 2' },
        { id: 'workspace_3', name: '画布 3' },
      ],
      activeWorkspaceId: 'workspace_2',
      snapshots: new Map([
        ['workspace_1', emptySnapshot],
        ['workspace_2', emptySnapshot],
        ['workspace_3', emptySnapshot],
      ]),
    }

    const next = removeCanvasWorkspace(state, 'workspace_2')

    expect(next.workspaces.map(workspace => workspace.id)).toEqual(['workspace_1', 'workspace_3'])
    expect(next.activeWorkspaceId).toBe('workspace_3')
    expect(next.snapshots.has('workspace_2')).toBe(false)
    expect(next.snapshots.has('workspace_1')).toBe(true)
    expect(next.snapshots.has('workspace_3')).toBe(true)
  })

  it('removes the last active workspace and selects the previous cached workspace', () => {
    const emptySnapshot: CanvasWorkspaceSnapshot = {
      document: { nodes: [], connections: [], selectedNodeId: null },
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const state = {
      workspaces: [
        { id: 'workspace_1', name: '画布 1' },
        { id: 'workspace_2', name: '画布 2' },
        { id: 'workspace_3', name: '画布 3' },
      ],
      activeWorkspaceId: 'workspace_3',
      snapshots: new Map([
        ['workspace_1', emptySnapshot],
        ['workspace_2', emptySnapshot],
        ['workspace_3', emptySnapshot],
      ]),
    }

    const next = removeCanvasWorkspace(state, 'workspace_3')

    expect(next.workspaces).toEqual([
      { id: 'workspace_1', name: '画布 1' },
      { id: 'workspace_2', name: '画布 2' },
    ])
    expect(next.activeWorkspaceId).toBe('workspace_2')
    expect(next.snapshots.has('workspace_3')).toBe(false)
    expect(next.snapshots.get('workspace_2')).toEqual(emptySnapshot)
  })

  it('keeps the active workspace when deleting a different workspace', () => {
    const state = {
      workspaces: [
        { id: 'workspace_1', name: '画布 1' },
        { id: 'workspace_2', name: '画布 2' },
      ],
      activeWorkspaceId: 'workspace_1',
      snapshots: new Map<string, CanvasWorkspaceSnapshot>(),
    }

    const next = removeCanvasWorkspace(state, 'workspace_2')

    expect(next.activeWorkspaceId).toBe('workspace_1')
    expect(next.workspaces).toEqual([{ id: 'workspace_1', name: '画布 1' }])
  })

  it('keeps the last workspace so the canvas always has an active target', () => {
    const state = {
      workspaces: [{ id: 'workspace_1', name: '画布 1' }],
      activeWorkspaceId: 'workspace_1',
      snapshots: new Map<string, CanvasWorkspaceSnapshot>(),
    }

    expect(removeCanvasWorkspace(state, 'workspace_1')).toBe(state)
  })
})
