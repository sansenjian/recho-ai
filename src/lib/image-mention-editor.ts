import type { Directive, DirectiveBinding } from 'vue'

export interface MentionImageTokenSource {
  id: string
  title: string
  imageUrl?: string
}

export type MentionTokenResolver = (
  id?: string,
  title?: string,
) => MentionImageTokenSource | null

export function serializeRichEditor(root: HTMLElement) {
  let value = ''
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-token')) {
      const id = node.dataset.mentionId
      if (id) value += `{{image:${id}}}`
      return
    }
    node.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  const serialized = value.replace(/\u00a0/g, ' ')
  root.dataset.serialized = serialized
  return serialized
}

export function textBeforeCaret(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return ''
  const activeRange = selection.getRangeAt(0)
  if (!root.contains(activeRange.startContainer)) return ''

  let value = ''
  const appendEditableText = (node: Node) => {
    if (node instanceof HTMLElement && node.classList.contains('mention-token')) return
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? ''
      return
    }
    node.childNodes.forEach(appendEditableText)
  }
  const visit = (node: Node): boolean => {
    if (node instanceof HTMLElement && node.classList.contains('mention-token')) return false
    if (node === activeRange.startContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        value += (node.textContent ?? '').slice(0, activeRange.startOffset)
      } else {
        Array.from(node.childNodes)
          .slice(0, activeRange.startOffset)
          .forEach(appendEditableText)
      }
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? ''
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true
    }
    return false
  }

  visit(root)
  return value
}

export function setRichEditorSelection(root: HTMLElement, start: number, end: number) {
  const range = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(textNode) {
      const parent = textNode.parentElement
      return parent?.closest('.mention-token') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  let offset = 0
  let current = walker.nextNode()
  let startSet = false

  while (current) {
    const text = current.textContent ?? ''
    const nextOffset = offset + text.length
    if (!startSet && start <= nextOffset) {
      range.setStart(current, Math.max(0, start - offset))
      startSet = true
    }
    if (end <= nextOffset) {
      range.setEnd(current, Math.max(0, end - offset))
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return true
    }
    offset = nextOffset
    current = walker.nextNode()
  }

  range.selectNodeContents(root)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return startSet
}

export function createMentionTokenElement(imageNode: MentionImageTokenSource) {
  const token = document.createElement('span')
  token.className = 'mention-token'
  token.contentEditable = 'false'
  token.dataset.mentionId = imageNode.id
  Object.assign(token.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    maxWidth: '132px',
    minHeight: '26px',
    margin: '0 2px',
    padding: '2px 6px 2px 3px',
    border: '1px solid #dbe3ee',
    borderRadius: '7px',
    background: '#fff',
    color: 'var(--text-primary)',
    fontSize: 'calc(12px * var(--node-text-content-scale, 1))',
    fontWeight: '900',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  })

  if (imageNode.imageUrl) {
    const img = document.createElement('img')
    img.src = imageNode.imageUrl
    img.alt = imageNode.title
    Object.assign(img.style, {
      width: '20px',
      height: '20px',
      borderRadius: '5px',
      objectFit: 'cover',
      flex: '0 0 auto',
    })
    token.appendChild(img)
  }

  const label = document.createElement('span')
  label.textContent = imageNode.title
  Object.assign(label.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  })
  token.appendChild(label)
  return token
}

export function renderRichEditorContent(
  root: HTMLElement,
  value = '',
  resolveToken: MentionTokenResolver,
) {
  const fragment = document.createDocumentFragment()
  const tokenPattern = /\{\{image:([^}]+)\}\}|@([\u4e00-\u9fa5A-Za-z0-9_-]+)/g
  let cursor = 0

  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? cursor
    if (index > cursor) {
      fragment.append(document.createTextNode(value.slice(cursor, index)))
    }

    const imageNode = resolveToken(match[1], match[2])
    fragment.append(imageNode
      ? createMentionTokenElement(imageNode)
      : document.createTextNode(match[0]))
    cursor = index + match[0].length
  }

  if (cursor < value.length) {
    fragment.append(document.createTextNode(value.slice(cursor)))
  }

  root.replaceChildren(fragment)
  root.dataset.serialized = value
}

export function createRichContentDirective(resolveToken: MentionTokenResolver): Directive<HTMLElement, string> {
  return {
    mounted(el: HTMLElement, binding: DirectiveBinding<string>) {
      renderRichEditorContent(el, binding.value ?? '', resolveToken)
    },
    updated(el: HTMLElement, binding: DirectiveBinding<string>) {
      const value = binding.value ?? ''
      if (document.activeElement === el) return
      if (el.dataset.serialized === value) return
      renderRichEditorContent(el, value, resolveToken)
    },
  }
}
