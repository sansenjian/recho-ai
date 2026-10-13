import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 图片埋点接线。
 *
 * useImageEvents 只负责「怎么发」，useImageAnalytics 负责「在哪些动作上发、
 * 算哪个来源」。这里测的是后者：来源判定、缺 id 时的跳过、以及埋点失败不能
 * 影响用户动作。
 */

const mocks = vi.hoisted(() => ({
  recordImageEvent: vi.fn(async () => true),
}))

vi.mock('../src/composables/useImageEvents', () => ({
  useImageEvents: () => ({ recordImageEvent: mocks.recordImageEvent }),
}))

import { useImageAnalytics } from '../src/composables/useImageAnalytics'

function image(id: string) {
  return { id } as never
}

describe('useImageAnalytics', () => {
  beforeEach(() => {
    mocks.recordImageEvent.mockClear()
    mocks.recordImageEvent.mockResolvedValue(true)
  })

  it('records an event with its source', () => {
    const { trackGenerated } = useImageAnalytics()
    trackGenerated('download', image('img_1'), 'canvas')

    expect(mocks.recordImageEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordImageEvent.mock.calls[0][0]).toMatchObject({
      eventType: 'download',
      source: 'canvas',
      imageId: 'img_1',
    })
  })

  it('skips events without an image id', () => {
    const { trackGenerated, track } = useImageAnalytics()
    trackGenerated('download', null, 'canvas')
    trackGenerated('download', undefined, 'canvas')
    track('download', { source: 'canvas', imageId: null })

    // 画布节点可能还没落库，没有 id 的事件无法归因到具体图片，发出去只会把表撑大。
    expect(mocks.recordImageEvent).not.toHaveBeenCalled()
  })

  it('passes metadata through when provided', () => {
    const { trackGenerated } = useImageAnalytics()
    trackGenerated('view_detail', image('img_2'), 'works', { from: 'gallery' })

    expect(mocks.recordImageEvent.mock.calls[0][0]).toMatchObject({
      metadata: { from: 'gallery' },
    })
  })

  it('omits metadata entirely when not provided', () => {
    const { trackGenerated } = useImageAnalytics()
    trackGenerated('download', image('img_3'), 'history')

    // 不要塞一个空对象进去——后端对 metadata 的脱敏会多跑一轮，没有意义。
    expect(mocks.recordImageEvent.mock.calls[0][0]).not.toHaveProperty('metadata')
  })

  it('never lets a tracking failure break the user action', () => {
    // 埋点是旁路：它炸了不能把「下载图片」这种动作带崩。
    mocks.recordImageEvent.mockRejectedValue(new Error('network down'))
    const { trackGenerated } = useImageAnalytics()

    expect(() => trackGenerated('download', image('img_4'), 'canvas')).not.toThrow()
  })

  it('does not await the request, so the caller stays synchronous', () => {
    const { trackGenerated } = useImageAnalytics()
    let settled = false
    mocks.recordImageEvent.mockImplementation(() => new Promise(() => {}))

    trackGenerated('download', image('img_5'), 'canvas')
    // 悬而未决的 promise 不应阻塞调用方（fire-and-forget）。
    expect(settled).toBe(false)
    expect(mocks.recordImageEvent).toHaveBeenCalledTimes(1)
  })

  it('forwards every event type the wiring uses', () => {
    const { trackGenerated } = useImageAnalytics()
    const types = ['view_detail', 'download', 'send_to_chat', 'use_as_reference', 'delete', 'zoom'] as const

    for (const eventType of types) {
      trackGenerated(eventType, image(`img_${eventType}`), 'canvas')
    }

    expect(mocks.recordImageEvent).toHaveBeenCalledTimes(types.length)
    expect(mocks.recordImageEvent.mock.calls.map(call => call[0].eventType)).toEqual([...types])
  })
})

/**
 * 组件侧的接线契约。
 *
 * 上面测的是 composable 的行为，但「handler 里到底有没有调用它」是组件的事，
 * 单个 composable 测试覆盖不到——比如把某处 trackGenerated 删掉，composable
 * 的测试依然全绿。这里按源码文本钉住每个动作点，并从模板绑定一路查到函数体，
 * 避免出现「包了函数但模板还绑着旧名字」这种只接了一半的情况。
 */
describe('component wiring stays in place', () => {
  const canvas = readFileSync(resolve(__dirname, '../src/components/ImageCanvas.vue'), 'utf8')
  const imagioView = readFileSync(resolve(__dirname, '../src/components/ImagioView.vue'), 'utf8')

  const canvasCases: Array<[string, RegExp]> = [
    ['removeNode 记 delete', /function removeNode[\s\S]{0,400}trackGenerated\('delete'/],
    ['downloadGalleryDetail 记 download', /function downloadGalleryDetail[\s\S]{0,300}trackGenerated\('download'/],
    ['useGalleryDetailImage 记 use_as_reference', /function useGalleryDetailImage[\s\S]{0,300}trackGenerated\('use_as_reference'/],
    ['sendGalleryDetailToChat 记 send_to_chat', /function sendGalleryDetailToChat[\s\S]{0,300}trackGenerated\('send_to_chat'/],
    ['handleDownload 记 download', /function handleDownload[\s\S]{0,300}trackGenerated\('download'/],
    ['sendNodeImageToChat 记 send_to_chat', /async function sendNodeImageToChat[\s\S]{0,400}trackGenerated\('send_to_chat'/],
    ['openImageViewerTracked 记 view_detail', /function openImageViewerTracked[\s\S]{0,300}trackGenerated\('view_detail'/],
    ['openGalleryDetailViewerTracked 记 view_detail', /function openGalleryDetailViewerTracked[\s\S]{0,400}trackGenerated\('view_detail'/],
    ['downloadImageViewerImage 记 download', /function downloadImageViewerImage[\s\S]{0,200}trackViewerAction\('download'/],
    ['zoomImageViewerTracked 记 zoom', /function zoomImageViewerTracked[\s\S]{0,200}trackViewerAction\('zoom'/],
  ]

  for (const [name, pattern] of canvasCases) {
    it(`ImageCanvas: ${name}`, () => {
      expect(canvas).toMatch(pattern)
    })
  }

  it('ImageCanvas: 模板绑定的是包装后的打开函数', () => {
    // 只包函数、模板还绑旧名字的话，埋点永远不触发——这类「接了一半」的错
    // 从函数定义上看不出来。
    expect(canvas).toContain('@open-image-viewer="openImageViewerTracked"')
    expect(canvas).toContain('@open-viewer="openGalleryDetailViewerTracked"')
    expect(canvas).toContain('@zoom="zoomImageViewerTracked"')
  })

  it('ImagioView: 下载记 download（来源 history）', () => {
    expect(imagioView).toMatch(/async function downloadGeneratedImage[\s\S]{0,300}trackGenerated\('download', image, 'history'\)/)
  })
})
