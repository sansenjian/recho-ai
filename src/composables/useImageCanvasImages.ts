import { nextTick } from 'vue'
import type { CanvasNode } from '../lib/image-canvas-model'
import {
  clipboardImageFile,
  compressReferenceImageDataUrl,
  fallbackImageFileName,
  imageDimensionsFromHistory,
  readImageDimensions,
  readImageFileAsDataUrl,
} from '../lib/image-canvas-utils'
import { previewImageUrl } from '../lib/image-gallery'
import type { GeneratedImage } from '../types/image'
import type { ImageHistoryScope } from './useImageGen'

interface CanvasPoint {
  x: number
  y: number
}

export interface UseImageCanvasImagesOptions {
  getNodeById: (nodeId: string) => CanvasNode | null | undefined
  createImageNode: (x: number, y: number, data?: Partial<CanvasNode>) => CanvasNode
  nextImageTitle: (excludeNodeId?: string) => string
  removeNode: (nodeId: string) => void
  pasteNodeFromClipboard: () => boolean
  selectCanvasWorkspace: () => void
  isImageViewerOpen: () => boolean
  isEditableEventTarget: (event: Event) => boolean
  canCreateImageNodeFromPaste?: () => boolean
  imageNodePositionNearCenter: () => CanvasPoint | null
  historyImageDropPoint: () => CanvasPoint
  resolveImageDetail: (
    image: GeneratedImage,
    scope?: ImageHistoryScope,
    options?: { requireStoragePath?: boolean },
  ) => Promise<GeneratedImage>
  setError: (message: string) => void
}

export function useImageCanvasImages(options: UseImageCanvasImagesOptions) {
  async function applyImageFileToNode(nodeId: string, file: File) {
    const dataUrl = await compressReferenceImageDataUrl(await readImageFileAsDataUrl(file))
    const node = options.getNodeById(nodeId)
    if (!node) return
    node.imageUrl = dataUrl
    Object.assign(node, await readImageDimensions(dataUrl).catch(() => ({})))
    node.fileName = fallbackImageFileName(file)
    if (!/^图片\d+$/.test(node.title.trim())) {
      node.title = options.nextImageTitle(node.id)
    }
  }

  function chooseImage(nodeId: string) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void applyImageFileToNode(nodeId, file).catch(() => {
        options.setError('图片读取失败，请重新选择图片。')
      })
    }
    input.click()
  }

  async function handleWindowPaste(event: ClipboardEvent) {
    const file = clipboardImageFile(event)
    if (options.isImageViewerOpen()) return

    if (!file) {
      if (options.isEditableEventTarget(event)) return
      if (options.pasteNodeFromClipboard()) {
        event.preventDefault()
      }
      return
    }
    if (options.canCreateImageNodeFromPaste && !options.canCreateImageNodeFromPaste()) return

    event.preventDefault()
    options.selectCanvasWorkspace()
    await nextTick()

    const position = options.imageNodePositionNearCenter() ?? { x: 720, y: 420 }
    const node = options.createImageNode(position.x, position.y, {
      title: options.nextImageTitle(),
      content: '',
    })

    try {
      await applyImageFileToNode(node.id, file)
    } catch {
      options.removeNode(node.id)
      options.setError('剪贴板图片读取失败，请重新复制图片后再试。')
    }
  }

  async function useHistoryImage(image: GeneratedImage, scope: ImageHistoryScope = 'mine') {
    let detail = image
    let previewUrl = detail.previewUrl || ''
    if (!previewUrl || !detail.storagePath) {
      detail = await options.resolveImageDetail(image, scope, { requireStoragePath: true })
      previewUrl = previewImageUrl(detail)
    }

    if (!previewUrl) {
      options.setError('图片加载失败，请稍后重试。')
      return
    }

    options.selectCanvasWorkspace()
    const point = options.historyImageDropPoint()

    options.createImageNode(point.x, point.y, {
      title: options.nextImageTitle(),
      content: '',
      imageUrl: previewUrl,
      storagePath: detail.storagePath,
      sourceImageId: detail.id,
      sourceHistoryScope: scope,
      sourcePrompt: detail.prompt,
      fileName: detail.size,
      ...imageDimensionsFromHistory(detail),
    })
  }

  return {
    applyImageFileToNode,
    chooseImage,
    handleWindowPaste,
    useHistoryImage,
  }
}
