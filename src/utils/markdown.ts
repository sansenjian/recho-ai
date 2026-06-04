import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import type { Message } from '../types'
import { stripThinking } from './messageText'

export { extractThinking, sanitizeVisibleAssistantText, stripThinking } from './messageText'

const md: MarkdownIt = new MarkdownIt({
  breaks: true,
  linkify: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch { /* fallthrough */ }
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`
  },
})

const renderedCache = new Map<number, { source: string; html: string }>()

export function getRendered(msg: Message): string | undefined {
  if (msg.role !== 'assistant') return undefined
  const cached = renderedCache.get(msg.id)
  if (cached !== undefined && cached.source === msg.content) return cached.html
  const source = msg.content
  const html = md.render(stripThinking(source))
  renderedCache.set(msg.id, { source, html })
  return html
}

export function getRenderedText(text: string): string {
  return md.render(stripThinking(text))
}

export function clearRenderCache(): void {
  renderedCache.clear()
}
