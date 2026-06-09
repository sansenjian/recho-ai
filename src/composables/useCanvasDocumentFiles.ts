import {
  buildCanvasExportDocument,
  parseCanvasExportDocument,
  type CanvasExportDocument,
  type CanvasRuntimeNode,
  type CanvasViewportState,
  type CanvasDocumentConnection,
} from '../lib/canvas-document'

export interface UseCanvasDocumentFilesOptions {
  canvasId: string
  title: string
  version: 1
  getViewport: () => CanvasViewportState
  getNodes: () => CanvasRuntimeNode[]
  getConnections: () => CanvasDocumentConnection[]
  importDocument: (document: CanvasExportDocument, mode: 'append' | 'replace') => void
  setError: (message: string) => void
  maxFileBytes: number
}

function safeCanvasFileName() {
  const date = new Date().toISOString().slice(0, 10)
  return `recho-canvas-${date}.json`
}

function triggerDownload(href: string, fileName: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function useCanvasDocumentFiles(options: UseCanvasDocumentFilesOptions) {
  function buildDocument() {
    return buildCanvasExportDocument({
      canvasId: options.canvasId,
      title: options.title,
      version: options.version,
      viewport: options.getViewport(),
      nodes: options.getNodes(),
      connections: options.getConnections(),
    })
  }

  function exportCanvasToFile() {
    const json = JSON.stringify(buildDocument(), null, 2)
    const objectUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    triggerDownload(objectUrl, safeCanvasFileName())
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  function importCanvasFromFile(event: Event, mode: 'append' | 'replace' = 'append') {
    const input = event.currentTarget as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) return
    if (file.size > options.maxFileBytes) {
      options.setError('画布文件过大，请导入 5MB 以内的 JSON 文件。')
      if (input) input.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const document = parseCanvasExportDocument(JSON.parse(String(reader.result || '')))
        options.importDocument(document, mode)
      } catch (err) {
        options.setError(err instanceof Error ? err.message : '画布导入失败')
      } finally {
        if (input) input.value = ''
      }
    }
    reader.onerror = () => {
      options.setError('画布文件读取失败')
      if (input) input.value = ''
    }
    reader.readAsText(file)
  }

  return {
    exportCanvasToFile,
    importCanvasFromFile,
  }
}
