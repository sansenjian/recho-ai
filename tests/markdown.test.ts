import { describe, expect, it } from 'vitest'
import type { Message } from '../src/types'
import { clearRenderCache, getRendered, getRenderedText, stripThinking } from '../src/utils/markdown'

function makeAssistant(content: string): Message {
  return {
    id: 1,
    role: 'assistant',
    content,
    timestamp: 'now',
  }
}

describe('markdown rendering cache', () => {
  it('rerenders when streamed content changes even if the previous HTML is longer', () => {
    clearRenderCache()
    const msg = makeAssistant('hello')

    expect(getRendered(msg)).toContain('hello')

    msg.content = 'hello world!'

    expect(msg.content.length).toBeLessThan('<p>hello</p>\n'.length)
    expect(getRendered(msg)).toContain('hello world!')
  })

  it('removes leaked analysis fragments from assistant-visible text', () => {
    const leaked = [
      "我有线 understanding the user's query),",
      '["budget", "preferences.", "headphones高尔夫球"]',
      '}请问您的预算GG // Es konnte sein, dass der Benutzer | Final Extract after | Grundlegend思考：User möchte wissen',
      '不过您的问题不太完整，希望我能帮助您！',
    ].join('\n')

    const visible = stripThinking(leaked)

    expect(visible).not.toContain("understanding the user's query")
    expect(visible).not.toContain('Final Extract')
    expect(visible).not.toContain('Grundlegend')
    expect(visible).toContain('请问您的预算')
  })

  it('uses the registered HTML-like grammar for html, svg, and vue fences', () => {
    const html = getRenderedText('```html\n<div class="note">Hello</div>\n```')
    const svg = getRenderedText('```svg\n<svg viewBox="0 0 1 1"></svg>\n```')
    const vue = getRenderedText('```vue\n<template><div>{{ message }}</div></template>\n```')

    expect(html).toContain('language-html')
    expect(svg).toContain('language-svg')
    expect(vue).toContain('language-vue')
    expect(html).toContain('hljs-tag')
    expect(svg).toContain('hljs-tag')
    expect(vue).toContain('hljs-tag')
  })
})
