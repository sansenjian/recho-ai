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

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name)
}

function imageFilesFromTransfer(dataTransfer: DataTransfer | null) {
  return Array.from(dataTransfer?.files ?? []).filter(isImageFile)
}

function hasFileTransfer(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes('Files') || Array.from(event.dataTransfer?.items ?? []).some(item => item.kind === 'file')
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

  async function createImageNodeFromFile(file: File, position: CanvasPoint, errorMessage: string) {
    const node = options.createImageNode(position.x, position.y, {
      title: options.nextImageTitle(),
      content: '',
    })

    try {
      await applyImageFileToNode(node.id, file)
      return true
    } catch {
      options.removeNode(node.id)
      options.setError(errorMessage)
      return false
    }
  }

  function handleImageDragOver(event: DragEvent) {
    if (!hasFileTransfer(event)) return false
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    return true
  }

  async function handleImageDrop(event: DragEvent, position: CanvasPoint) {
    if (!hasFileTransfer(event)) return false
    event.preventDefault()
    event.stopPropagation()

    const files = imageFilesFromTransfer(event.dataTransfer)
    if (!files.length) {
      options.setError('只能拖入图片文件。')
      return false
    }

    options.selectCanvasWorkspace()
    await nextTick()

    for (let index = 0; index < files.length; index += 1) {
      await createImageNodeFromFile(
        files[index],
        { x: position.x + index * 36, y: position.y + index * 36 },
        '拖放图片读取失败，请重新拖入图片。',
      )
    }

    return true
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
    await createImageNodeFromFile(file, position, '剪贴板图片读取失败，请重新复制图片后再试。')
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
    handleImageDragOver,
    handleImageDrop,
    handleWindowPaste,
    useHistoryImage,
  }
}
