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
 * 已签发的地址，按路径缓存到接近到期。
 *
 * 上面那张表只在请求在途时有效，一落地就删；而签名本身有 6 小时有效期
 * （Go 侧 presignTTL）。没有这一层，每次打开查看器、每次左右翻页都会重新
 * 走一遍签发，服务端也要为同一张图重跑一次访问校验——校验是三列 OR 反查，
 * 用不上单列索引，代价不低。
 *
 * 提前 5 分钟视为过期：签发与展示之间还隔着一次网络往返，卡在到期点上会让
 * 用户正好拿到一个刚失效的地址，然后走一趟裂图 → 回落的弯路。
 */
const PRESIGN_CACHE_SAFETY_WINDOW_MS = 5 * 60_000
const issued = new Map<string, PresignedImageUrl>()

function readCachedPresign(storagePath: string): PresignedImageUrl | null {
  const cached = issued.get(storagePath)
  if (!cached) return null
  const expiresAtMs = cached.expiresAt * 1000
  // expiresAt 为 0 表示存储没给出有效期，无法判断何时过期，不缓存。
  if (!expiresAtMs) {
    issued.delete(storagePath)
    return null
  }
  if (expiresAtMs - PRESIGN_CACHE_SAFETY_WINDOW_MS <= Date.now()) {
    issued.delete(storagePath)
    return null
  }
  return cached
}

/**
 * 账号切换或登出时清空缓存。
 *
 * 缓存本身不校验权限：能不能看某张图在签发那一刻就已经判定了。如果换了账号还
 * 留着上一个账号的地址，私有图会在有效期内继续可读——鉴权在这个模块里必须靠
 * 清缓存来兜住。
 */
export function clearPresignedImageCache() {
  issued.clear()
  inFlight.clear()
}

/**
 * 签发单张图。
 *
 * 返回 null 表示这次没拿到（未登录、存储不支持、网络异常、无权限），调用方应当
 * 回落到代理取图，而不是把它当成错误。
 */
export function requestPresignedImageUrl(storagePath: string): Promise<PresignedImageUrl | null> {
  if (!storagePath) return Promise.resolve(null)

  const cached = readCachedPresign(storagePath)
  if (cached) return Promise.resolve(cached)

  const pending = inFlight.get(storagePath)
  if (pending) return pending

  const request = (async () => {
    const issuedUrls = await fetchPresignedImageUrls([storagePath])
    const signed = issuedUrls.get(storagePath) ?? null
    // 只缓存签发成功的；失败要留下重试机会，否则一次网络抖动会让这张图在
    // 整个会话里都只能走代理。
    if (signed?.expiresAt) issued.set(storagePath, signed)
    return signed
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
