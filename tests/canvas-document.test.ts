import { describe, expect, it } from 'vitest'
import {
  buildCanvasExportDocument,
  normalizeCanvasImport,
  parseCanvasExportDocument,
  type CanvasExportDocument,
  type CanvasRuntimeNode,
} from '../src/lib/canvas-document'

function baseNode(overrides: Partial<CanvasRuntimeNode>): CanvasRuntimeNode {
  return {
    id: 'node_1',
    type: 'text',
    x: 0,
    y: 0,
    title: '节点',
    content: '',
    size: 'auto',
    aspectRatio: 'auto',
    resolution: 'auto',
    quality: 'auto',
    ...overrides,
  }
}

describe('canvas document helpers', () => {
  it('exports image references without embedded image bodies', () => {
    const document = buildCanvasExportDocument({
      canvasId: 'canvas_1',
      title: 'Canvas',
      viewport: { x: 1, y: 2, zoom: 1 },
      exportedAt: '2026-06-06T00:00:00.000Z',
      nodes: [
        baseNode({
          id: 'img_data',
          type: 'image',
          imageUrl: 'data:image/png;base64,AAAA',
          fileName: 'local.png',
          sourceImageId: 'history_1',
        }),
        baseNode({
          id: 'img_blob',
          type: 'image',
          imageUrl: 'blob:http://localhost/image',
          fileName: 'blob.png',
        }),
        baseNode({
          id: 'img_url',
          type: 'image',
          imageUrl: 'https://example.com/image.png',
          fileName: 'remote.png',
          sourcePrompt: 'hidden generation prompt',
        }),
      ],
      connections: [],
    })

    expect(JSON.stringify(document)).not.toContain('base64')
    expect(JSON.stringify(document)).not.toContain('blob:http')
    expect(JSON.stringify(document)).not.toContain('hidden generation prompt')
    expect(document.canvas.nodes.find(node => node.id === 'img_data')?.imageUrl).toBeUndefined()
    expect(document.canvas.nodes.find(node => node.id === 'img_blob')?.imageUrl).toBeUndefined()
    expect(document.canvas.nodes.find(node => node.id === 'img_url')?.imageUrl).toBe('https://example.com/image.png')
    expect(document.canvas.nodes.find(node => node.id === 'img_url')?.sourcePrompt).toBeUndefined()
    expect(document.assets).toEqual({
      mode: 'references-only',
      images: [
        {
          nodeId: 'img_data',
          fileName: 'local.png',
          sourceImageId: 'history_1',
        },
        {
          nodeId: 'img_blob',
          fileName: 'blob.png',
        },
        {
          nodeId: 'img_url',
          url: 'https://example.com/image.png',
          fileName: 'remote.png',
        },
      ],
    })
  })

  it('normalizes imported nodes and drops invalid connections', () => {
    const document: CanvasExportDocument = parseCanvasExportDocument({
      schema: 'recho.canvas',
      version: 1,
      exportedAt: '2026-06-06T00:00:00.000Z',
      canvas: {
        id: 'canvas_1',
        title: 'Canvas',
        version: 1,
        viewport: { x: 10, y: 20, zoom: 99 },
        nodes: [
          baseNode({ id: 'text_1', type: 'text', content: 'Prompt' }),
          baseNode({ id: 'generation_1', type: 'generation' }),
          baseNode({ id: 'image_1', type: 'image', imageUrl: 'data:image/png;base64,AAAA' }),
        ],
        connections: [
          {
            id: 'valid_prompt',
            fromNodeId: 'text_1',
            fromHandle: 'text-out',
            toNodeId: 'generation_1',
            toHandle: 'prompt-in',
          },
          {
            id: 'invalid_kind',
            fromNodeId: 'text_1',
            fromHandle: 'text-out',
            toNodeId: 'image_1',
            toHandle: 'image-in',
          },
          {
            id: 'missing_node',
            fromNodeId: 'missing',
            fromHandle: 'image-out',
            toNodeId: 'generation_1',
            toHandle: 'reference-in',
          },
        ],
      },
      assets: { mode: 'references-only', images: [] },
    })

    const imported = normalizeCanvasImport(document, {
      mode: 'append',
      existingNodeIds: ['text_1'],
      createNodeId: type => `${type}_new`,
      createConnectionId: () => 'conn_new',
      minViewportZoom: 0.42,
      maxViewportZoom: 1.4,
    })

    expect(imported.nodes.map(node => node.id)).toEqual(['text_new', 'generation_1', 'image_1'])
    expect(imported.nodes.find(node => node.id === 'image_1')?.imageUrl).toBeUndefined()
    expect(imported.connections).toEqual([
      {
        id: 'conn_new',
        fromNodeId: 'text_new',
        fromHandle: 'text-out',
        toNodeId: 'generation_1',
        toHandle: 'prompt-in',
      },
    ])
    expect(imported.viewport).toEqual({ x: 10, y: 20, zoom: 1.4 })
  })

  it('rejects duplicate node ids in an imported canvas document', () => {
    const document: CanvasExportDocument = parseCanvasExportDocument({
      schema: 'recho.canvas',
      version: 1,
      exportedAt: '2026-06-06T00:00:00.000Z',
      canvas: {
        id: 'canvas_1',
        title: 'Canvas',
        version: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          baseNode({ id: 'duplicate_1', type: 'text' }),
          baseNode({ id: 'duplicate_1', type: 'generation' }),
        ],
        connections: [],
      },
      assets: { mode: 'references-only', images: [] },
    })

    expect(() => normalizeCanvasImport(document, { mode: 'replace' }))
      .toThrow('画布文件包含重复节点 ID')
  })
})
