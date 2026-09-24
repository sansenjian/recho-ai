import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadImages } from '../io.js'
import type { ImageResult } from '../types.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('downloadImages', () => {
  it('清洗 img.id(路径遍历)并回退非白名单扩展名', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recho-io-'))
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('fake-image-bytes', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })),
      )
      const img: ImageResult = {
        // id 含 ../ 与非法字符,URL 扩展名是 .desktop(不在白名单)
        id: '../../.config/autostart/evil',
        url: 'https://cdn.example.com/a.desktop',
      }
      const saved = await downloadImages([img], dir)
      const files = await readdir(dir)

      // 文件只落在 dir 内部,且没有向上一层的 autostart 目录
      expect(saved).toHaveLength(1)
      expect(files).toEqual(['evil.png'])
      expect(files.some((f) => f.includes('config') || f.includes('autostart'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('保留合法的图片扩展名与 id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recho-io-'))
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('fake-image-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })),
      )
      const img: ImageResult = { id: 'img_1', url: 'https://cdn.example.com/photo.JPEG' }
      const saved = await downloadImages([img], dir)
      expect(saved).toEqual([join(dir, 'img_1.jpeg')])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})