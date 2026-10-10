import type { GeneratedImage } from '../types/image'
import { galleryFileName } from './image-gallery'

/**
 * 下载存盘用的文件名。
 *
 * 只保留提示词的可见部分并裁短。早期实现把内部图片 id（img_1791...）也拼进去，
 * 文件名长到在「另存为」对话框里要折三行，却看不出是哪张图。
 *
 * 命名规则与画廊一致（见 galleryFileName），所以同一张图在画廊和下载目录里名字
 * 对得上；扩展名固定 .png，是因为下载链路会把图像转成 PNG 再存盘。
 */
export function imageDownloadFileName(image: GeneratedImage) {
  const base = galleryFileName(image)
    .replace(/\.[a-z0-9]+$/i, '')
    .slice(0, 48)
  return `${base || 'recho_image'}.png`
}
