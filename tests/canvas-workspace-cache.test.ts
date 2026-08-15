import { describe, expect, it } from 'vitest'
import {
  parseCanvasWorkspaceSnapshots,
  serializeCanvasWorkspaceSnapshots,
  type CanvasWorkspaceSnapshot,
} from '../src/lib/canvas-workspace-cache'

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
})
