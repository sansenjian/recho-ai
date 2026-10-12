import { getAuthAccessToken } from './useAuthSession'
import { imageApiUrl } from '../lib/api-base'

/**
 * 一个带时效的直连地址。
 *
 * 服务端签发后浏览器直接向对象存储取图，图片流量不再经过本服务——图片是二进制
 * 大文件，走代理意味着每张图都从服务器转发一次。
 */
export interface PresignedImageUrl {
  url: string
  /** Unix 秒。前端据此在到期前重新签发。 */
  expiresAt: number
}

/**
 * 批量签发。
 *
 * 之所以是批量：图库一次渲染几十张，逐张请求会把签发本身变成新的瓶颈。
 *
 * 返回的 Map 只包含签发成功的路径；失败或不被允许的路径不在其中，调用方据此
 * 回落到代理取图。把失败当成整体错误会让一次签发失败变成整页图片加载失败。
 */
/**
 * 同一路径的并发请求合并成一次。
 *
 * 一次渲染里几十张图各自请求会把签发本身变成瓶颈，而组件是按单张挂载的，
 * 看不到彼此。这里按路径去重，请求在途时后来的调用直接复用同一个 Promise。
 */
const inFlight = new Map<string, Promise<PresignedImageUrl | null>>()

/**
 * 签发单张图。
 *
 * 返回 null 表示这次没拿到（未登录、存储不支持、网络异常、无权限），调用方应当
 * 回落到代理取图，而不是把它当成错误。
 */
export function requestPresignedImageUrl(storagePath: string): Promise<PresignedImageUrl | null> {
  if (!storagePath) return Promise.resolve(null)

  const pending = inFlight.get(storagePath)
  if (pending) return pending

  const request = (async () => {
    const issued = await fetchPresignedImageUrls([storagePath])
    return issued.get(storagePath) ?? null
  })()
  inFlight.set(storagePath, request)
  // 无论成败都要释放，否则一次失败会让这个路径永远拿不到重新签发的机会。
  void request.finally(() => { inFlight.delete(storagePath) })
  return request
}

export async function fetchPresignedImageUrls(
  storagePaths: string[],
): Promise<Map<string, PresignedImageUrl>> {
  const result = new Map<string, PresignedImageUrl>()
  if (!storagePaths.length) return result

  try {
    // 取 token 必须在 try 内：它自己会走一次会话读取，抛错时若逃出去，调用方的
    // watch 回调会在半途中断，连代理回落都不会执行，图片就完全不显示了。
    const token = await getAuthAccessToken()
    const res = await fetch(imageApiUrl('/api/image/storage/presign'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ paths: storagePaths }),
    })
    if (!res.ok) return result

    const payload = await res.json() as {
      items?: Array<{ path?: string; url?: string; expiresAt?: number }>
    }
    for (const item of payload.items ?? []) {
      if (!item?.path || !item.url) continue
      result.set(item.path, { url: item.url, expiresAt: Number(item.expiresAt) || 0 })
    }
  } catch {
    // 签发失败不该打断浏览：调用方会回落到代理。
  }
  return result
}
