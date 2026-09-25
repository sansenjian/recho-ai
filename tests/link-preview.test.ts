import { describe, expect, it } from 'vitest'
import { extractLinkPreview } from '../src/utils/linkPreview'

describe('extractLinkPreview', () => {
  it('extracts a preview from a markdown link', () => {
    expect(extractLinkPreview('参考 [Vite 官网](https://vite.dev/guide/) 获取最新文档。')).toEqual({
      url: 'https://vite.dev/guide/',
      title: 'Vite 官网',
      summary: '参考 Vite 官网 获取最新文档。',
      hostname: 'vite.dev',
    })
  })

  it('uses the hostname for a bare URL and ignores unsupported protocols', () => {
    expect(extractLinkPreview('打开 https://example.com/docs。')).toMatchObject({
      url: 'https://example.com/docs',
      title: 'example.com',
      hostname: 'example.com',
    })
    expect(extractLinkPreview('file:///tmp/example')).toBeNull()
  })

  it('returns null when a message has no web link', () => {
    expect(extractLinkPreview('这是一条普通对话。')).toBeNull()
  })
})
