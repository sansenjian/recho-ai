import { describe, expect, it } from 'vitest'
import { imageDownloadFileName } from '../src/lib/image-download-name'
import type { GeneratedImage } from '../src/types/image'

function img(prompt: string, id = 'img_1'): GeneratedImage {
  return { id, prompt, userPrompt: prompt, size: '1024x1024', timestamp: '2026-01-01T00:00:00.000Z' }
}

describe('imageDownloadFileName', () => {
  it('does not embed the internal image id', () => {
    // 旧实现拼上 img_1791...，文件名长到在「另存为」里折三行，还看不出是哪张图。
    const name = imageDownloadFileName(img('a dot', 'img_1791392542415681700_0_f67bfdc63ec726607a710021e70c7a5a'), 'image/png')
    expect(name).not.toContain('img_1791392542415681700')
    expect(name).toBe('a_dot.png')
  })

  it('takes the extension from the real mime type', () => {
    // 存储代理可能返回 webp；写死 .png 会让后缀和内容对不上，双击才发现打不开。
    expect(imageDownloadFileName(img('a dot'), 'image/webp')).toBe('a_dot.webp')
    expect(imageDownloadFileName(img('a dot'), 'image/jpeg')).toBe('a_dot.jpg')
    expect(imageDownloadFileName(img('a dot'), 'image/png')).toBe('a_dot.png')
  })

  it('falls back to .bin when the type is unknown', () => {
    // 认不出类型时不能谎报格式。
    expect(imageDownloadFileName(img('a dot'))).toBe('a_dot.bin')
    expect(imageDownloadFileName(img('a dot'), 'application/octet-stream')).toBe('a_dot.bin')
  })

  it('keeps CJK text readable and stays short', () => {
    const name = imageDownloadFileName(img('一只坐在窗台上的橘猫，阳光斜射穿过玻璃杯里的水'), 'image/png')
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length).toBeLessThan(60)
    expect(name).toContain('橘猫')
  })

  it('falls back to a readable name when the prompt is blank', () => {
    // galleryPrompt 会给出「无提示词」，比裸露的 recho_image 更贴合界面语言。
    expect(imageDownloadFileName(img(''), 'image/png')).toBe('无提示词.png')
  })

  it('strips characters a file system would reject', () => {
    const name = imageDownloadFileName(img('a/b\\c:d*e?f"g<h>i|j'), 'image/png')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
  })
})
