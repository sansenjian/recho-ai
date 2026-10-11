import { imageDownloadFileName } from './image-download-name'
import type { GeneratedImage } from '../types/image'

/**
 * 让浏览器把一段内容存成文件。
 *
 * 触发下载必须借一个真实的 <a download>：没有别的 API 能指定文件名。
 * 四处代码原本各写一遍同样的「建 a → 点 → 移除」，漏掉移除就会在 DOM 里
 * 堆节点，这里统一收口。
 */
export function triggerFileDownload(href: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * 立刻回收 object URL 会中断下载——浏览器还没读完就失效了。
 * 延迟到足够长再释放，避免内存里长期挂着大图。
 */
const OBJECT_URL_REVOKE_DELAY_MS = 10_000

/**
 * 把一张生成图的 blob 存盘。
 *
 * 文件名后缀取自 blob 的真实 MIME：存储代理可能返回 webp，写死 .png 会让后缀
 * 和内容对不上。
 */
export function saveImageBlob(blob: Blob, image: GeneratedImage) {
  const objectUrl = URL.createObjectURL(blob)
  triggerFileDownload(objectUrl, imageDownloadFileName(image, blob.type))
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_REVOKE_DELAY_MS)
}
