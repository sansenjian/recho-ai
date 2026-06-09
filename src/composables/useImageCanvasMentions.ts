import { computed, ref, type Ref } from 'vue'
import type {
  CanvasNode,
  MentionField,
  MentionState,
} from '../lib/image-canvas-model'
import {
  createMentionTokenElement,
  serializeRichEditor,
  setRichEditorSelection,
  textBeforeCaret,
} from '../lib/image-mention-editor'

export interface UseImageCanvasMentionsOptions {
  nodes: Ref<CanvasNode[]>
  syncMentionConnectionsForGeneration: (node: CanvasNode) => void
  syncMentionConnectionsForTextNode: (node: CanvasNode) => void
}

export function useImageCanvasMentions(options: UseImageCanvasMentionsOptions) {
  const mentionState = ref<MentionState | null>(null)

  const mentionOptions = computed(() => {
    const query = mentionState.value?.query.trim().toLowerCase() ?? ''
    return options.nodes.value
      .filter(node => node.type === 'image' && node.imageUrl)
      .filter(node => {
        if (!query) return true
        const label = `${node.title} ${node.content} ${node.fileName ?? ''}`.toLowerCase()
        return label.includes(query)
      })
      .slice(0, 8)
  })

  function syncFieldConnections(node: CanvasNode, field: MentionField) {
    if (field === 'text') {
      options.syncMentionConnectionsForTextNode(node)
    } else {
      options.syncMentionConnectionsForGeneration(node)
    }
  }

  function closeMentionIndex(nodeId?: string, field?: MentionField) {
    if (!mentionState.value) return
    if (nodeId && mentionState.value.nodeId !== nodeId) return
    if (field && mentionState.value.field !== field) return
    mentionState.value = null
  }

  function updateMentionStateFromEditor(root: HTMLElement, node: CanvasNode, field: MentionField) {
    const beforeCaret = textBeforeCaret(root)
    const caret = beforeCaret.length
    const atIndex = beforeCaret.lastIndexOf('@')

    if (atIndex < 0) {
      closeMentionIndex(node.id, field)
      return
    }

    const query = beforeCaret.slice(atIndex + 1)
    if (/[\s\n\r]/.test(query)) {
      closeMentionIndex(node.id, field)
      return
    }

    const previous = mentionState.value
    const activeIndex = previous &&
      previous.nodeId === node.id &&
      previous.field === field &&
      previous.query === query &&
      previous.start === atIndex &&
      previous.end === caret
      ? previous.activeIndex
      : 0

    mentionState.value = {
      nodeId: node.id,
      field,
      query,
      start: atIndex,
      end: caret,
      activeIndex,
    }
  }

  function updateRichEditorContent(event: Event, node: CanvasNode, field: MentionField) {
    const el = event.currentTarget as HTMLElement
    node.content = serializeRichEditor(el)
    updateMentionStateFromEditor(el, node, field)
    syncFieldConnections(node, field)
  }

  function isMentionIndexOpen(node: CanvasNode, field: MentionField) {
    return mentionState.value?.nodeId === node.id &&
      mentionState.value.field === field &&
      mentionOptions.value.length > 0
  }

  function insertMention(node: CanvasNode, imageNode: CanvasNode) {
    const state = mentionState.value
    if (!state || state.nodeId !== node.id) return
    const editor = document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains('rich-editor')
      ? document.activeElement
      : null

    if (editor && setRichEditorSelection(editor, state.start, state.end)) {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (range) {
        range.deleteContents()
        const token = createMentionTokenElement(imageNode)
        const spacer = document.createTextNode(' ')
        range.insertNode(token)
        range.setStartAfter(token)
        range.collapse(true)
        range.insertNode(spacer)
        range.setStartAfter(spacer)
        range.collapse(true)
        selection?.removeAllRanges()
        selection?.addRange(range)
        node.content = serializeRichEditor(editor)
      }
    } else {
      const value = node.content
      const before = value.slice(0, state.start).replace(/[ \t]*$/, ' ')
      const after = value.slice(state.end).replace(/^[ \t]*/, '')
      node.content = `${before}{{image:${imageNode.id}}} ${after}`.trimStart()
    }

    mentionState.value = null
    syncFieldConnections(node, state.field)
  }

  function handleMentionKeydown(event: KeyboardEvent, node: CanvasNode, field: MentionField) {
    if (!isMentionIndexOpen(node, field)) return
    const options = mentionOptions.value
    const state = mentionState.value
    if (!state) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      mentionState.value = { ...state, activeIndex: (state.activeIndex + 1) % options.length }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      mentionState.value = { ...state, activeIndex: (state.activeIndex - 1 + options.length) % options.length }
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      insertMention(node, options[state.activeIndex] ?? options[0])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      mentionState.value = null
    }
  }

  return {
    mentionState,
    mentionOptions,
    updateRichEditorContent,
    updateMentionStateFromEditor,
    closeMentionIndex,
    isMentionIndexOpen,
    insertMention,
    handleMentionKeydown,
  }
}
