import type { GeneratedImage } from '../types/image'
import { galleryFileName } from './image-gallery'

/** 常见的图片 MIME 到扩展名。拿不准时回落 bin，至少不会谎报格式。 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/**
 * 下载存盘用的文件名。
 *
 * 只保留提示词的可见部分并裁短。早期实现把内部图片 id（img_1791...）也拼进去，
 * 文件名长到在「另存为」对话框里要折三行，却看不出是哪张图。
 *
 * 命名规则与画廊一致（见 galleryFileName），所以同一张图在画廊和下载目录里名字
 * 对得上。
 *
 * 扩展名按 blob 的真实类型给出，不写死 .png：存储代理可能返回 webp，那样用户拿到
 * 的是一个后缀与实际内容不符的文件，双击才发现打不开。类型缺失时回落 .bin。
 */
export function imageDownloadFileName(image: GeneratedImage, mimeType?: string) {
  const base = galleryFileName(image)
    .replace(/\.[a-z0-9]+$/i, '')
    .slice(0, 48)
  const extension = EXTENSION_BY_MIME[(mimeType || '').toLowerCase()] || 'bin'
  return `${base || 'recho_image'}.${extension}`
}