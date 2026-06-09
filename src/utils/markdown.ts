import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import type { Message } from '../types'
import { stripThinking } from './messageText'

export { extractThinking, sanitizeVisibleAssistantText, stripThinking } from './messageText'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)

hljs.registerAliases(['sh', 'shell', 'zsh', 'powershell', 'ps1'], { languageName: 'bash' })
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' })
hljs.registerAliases(['md'], { languageName: 'markdown' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' })

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
