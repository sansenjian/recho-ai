/**
 * 图片二进制内容的本地缓存。
 *
 * 图库里的每张图都要走一次鉴权请求才能显示，断网时整页空白——即使这些图用户刚
 * 才看过。这里把缩略图与预览图的 blob 存进 IndexedDB，离线时直接命中。
 *
 * 为什么不用 localStorage：它只接受字符串且总容量约 5MB，一张预览图就能撑满，
 * 而 base64 还要再膨胀三分之一。IndexedDB 能直接存 Blob，容量按配额走。
 *
 * 为什么单独一个数据库：历史元数据（useImageGen）用的是另一个库，共用会让任一边
 * 的版本升级都触发另一方重建。
 */

const DB_NAME = 'recho-image-blobs'
/** v2 起把元数据与 blob 分成两张表，见 META_STORE 的说明。 */
const DB_VERSION = 2
const META_STORE = 'meta'
const BLOB_STORE = 'blobs'

/**
 * 缓存元数据。
 *
 * 与 blob 分表存，是因为淘汰要扫全表算总占用、命中要刷新使用时间，而这两件事
 * 都不需要图片数据本身。放在一张表里就意味着每次写入都可能把几百 MB 的 blob
 * 读进内存只为数一下大小。
 */
interface CachedMeta {
  key: string
  size: number
  /** 最近一次被用到的时间，淘汰按它排序。 */
  usedAt: number
}

/** 总容量上限；超过后按最久未用淘汰。 */
export const IMAGE_BLOB_CACHE_LIMIT_BYTES = 200 * 1024 * 1024

/**
 * 账号清理的代次。
 *
 * 解决「在途写入把已清理的账号写回来」这个时序：
 *
 *   1. A 的取图请求发出，身份已定
 *   2. 响应还没回来，用户登出，A 的缓存被清掉
 *   3. 响应终于回来，把 A 的图又写进缓存
 *
 * 取图方在开始时记下代次，写回前比对；不一致说明期间发生过清理，直接丢弃。
 * 单靠「等清理跑完」挡不住更晚返回的请求。
 */
let ownerGeneration = 0

export function currentCacheGeneration() {
  return ownerGeneration
}

/** 清理某个账号时递增，使所有在途写入失效。 */
export function bumpCacheGeneration() {
  ownerGeneration += 1
  return ownerGeneration
}

/**
 * 未登录时的归属。
 *
 * 匿名用户看的是公开广场，和任何一个账号看到的都不该混在一起：他们的鉴权状态
 * 不同，能拿到的图也不同。
 */
export const ANONYMOUS_OWNER = 'anonymous'

/**
 * 生成缓存键。
 *
 * 三段缺一不可：
 *
 * - owner：换账号必须换一套缓存。命中缓存是不发请求的，也就没有服务端鉴权拦截，
 *   混在一起会让 B 看到 A 的图。
 * - mode：同一张图的缩略图与预览图是两份不同大小的内容，分开存才不会让大图
 *   拿到网格里的低清版本。
 * - storagePath：图片本身的标识。
 */
export function imageBlobCacheKey(owner: string, storagePath: string, mode: string) {
  return `${owner || ANONYMOUS_OWNER}:${mode}:${storagePath}`
}

function openDb(): Promise<IDBDatabase | null> {
  // 访问 indexedDB 本身就可能抛：隐私模式或站点数据被禁用时是 SecurityError。
  // 放在 Promise 外面会让整个取图链路挂死——连回退到网络都做不到，而缓存本来
  // 就只是加速手段，拿不到就该安静地走网络。
  try {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  } catch {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      console.warn('[image-blob-cache] IndexedDB unavailable', error)
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) {
        const store = db.createObjectStore(META_STORE, { keyPath: 'key' })
        // 淘汰按 usedAt 排序，建索引避免每次全量读出来再排。
        store.createIndex('usedAt', 'usedAt')
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE)
      }
      // v1 的单表已被拆开，旧数据不再需要：重建一次的代价只是首次浏览回源。
      if (db.objectStoreNames.contains('blobs') && db.objectStoreNames.contains('cached')) {
        db.deleteObjectStore('cached')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      console.warn('[image-blob-cache] IndexedDB open failed', request.error)
      resolve(null)
    }
    request.onblocked = () => {
      console.warn('[image-blob-cache] IndexedDB upgrade blocked')
      resolve(null)
    }
  })
}

/** 读缓存；未命中返回 null，调用方据此回退到网络。 */
export async function readImageBlob(key: string): Promise<Blob | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        const tx = db.transaction([META_STORE, BLOB_STORE], 'readonly')
        const req = tx.objectStore(BLOB_STORE).get(key)
        req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    if (!blob) return null
    // 命中即刷新使用时间，让刚看过的图不容易被淘汰。只改元数据表，不动 blob。
    void touchImageBlob(db, key)
    return blob
  } finally {
    db.close()
  }
}

function touchImageBlob(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(META_STORE, 'readwrite')
      const store = tx.objectStore(META_STORE)
      const req = store.get(key)
      req.onsuccess = () => {
        const meta = req.result as CachedMeta | undefined
        if (meta) {
          meta.usedAt = Date.now()
          store.put(meta)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * 写入缓存并在超限时淘汰。写入失败不影响调用方——缓存是尽力而为的。
 *
 * expectedGeneration 用于丢弃过期写入：取图方在请求开始时记下代次，若期间账号
 * 缓存被清理过，这次写入就不该落盘，否则登出后旧账号的图会被重新写回来。
 */
export async function writeImageBlob(
  key: string,
  blob: Blob,
  expectedGeneration?: number,
): Promise<void> {
  if (expectedGeneration !== undefined && expectedGeneration !== ownerGeneration) return

  const db = await openDb()
  if (!db) return
  // 打开数据库期间可能又发生了一次清理，落盘前再确认一次。
  if (expectedGeneration !== undefined && expectedGeneration !== ownerGeneration) {
    db.close()
    return
  }

  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
        tx.objectStore(BLOB_STORE).put(blob, key)
        tx.objectStore(META_STORE).put({ key, size: blob.size, usedAt: Date.now() } satisfies CachedMeta)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
    await evictImageBlobs(db)
  } catch (error) {
    console.warn('[image-blob-cache] write failed', error)
  } finally {
    db.close()
  }
}

/**
 * 按最久未用淘汰，直到总占用回到上限以内。
 *
 * 只扫元数据表：它每行只有 key 与两个数字，即使上千张图也能一次读完；真正占空间
 * 的 blob 只在确定要删时才按主键单独取。
 */
async function evictImageBlobs(db: IDBDatabase): Promise<void> {
  const metas = await new Promise<CachedMeta[]>((resolve) => {
    try {
      const tx = db.transaction(META_STORE, 'readonly')
      const req = tx.objectStore(META_STORE).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as CachedMeta[])
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })

  let total = metas.reduce((sum, meta) => sum + (meta.size ?? 0), 0)
  if (total <= IMAGE_BLOB_CACHE_LIMIT_BYTES) return

  const oldestFirst = metas.sort((a, b) => (a.usedAt ?? 0) - (b.usedAt ?? 0))
  const doomed: string[] = []
  for (const meta of oldestFirst) {
    if (total <= IMAGE_BLOB_CACHE_LIMIT_BYTES) break
    doomed.push(meta.key)
    total -= meta.size ?? 0
  }
  if (!doomed.length) return

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
      const metaStore = tx.objectStore(META_STORE)
      const blobStore = tx.objectStore(BLOB_STORE)
      for (const key of doomed) {
        metaStore.delete(key)
        blobStore.delete(key)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * 清掉某个账号的缓存。
 *
 * 退出登录时调它而不是清空整表：同一台机器上换回来还能命中旧缓存，不必重新下载；
 * 代价也从"删掉全部"降到"删掉一个人的"。
 *
 * 注意缓存键是 owner:mode:path，所以按前缀匹配即可——owner 里不会出现冒号
 * （Supabase 的 uuid 是连字符）。
 */
export async function clearImageBlobsForOwner(owner: string): Promise<void> {
  // 先递增：这样即使清理过程中有在途响应返回，它们也已经失效。
  bumpCacheGeneration()
  const db = await openDb()
  if (!db) return
  const prefix = `${owner || ANONYMOUS_OWNER}:`
  try {
    const doomed = await new Promise<string[]>((resolve) => {
      try {
        const tx = db.transaction(META_STORE, 'readonly')
        const req = tx.objectStore(META_STORE).getAllKeys()
        req.onsuccess = () => resolve((req.result ?? []).map(String).filter(key => key.startsWith(prefix)))
        req.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
    if (!doomed.length) return

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
        const metaStore = tx.objectStore(META_STORE)
        const blobStore = tx.objectStore(BLOB_STORE)
        for (const key of doomed) {
          metaStore.delete(key)
          blobStore.delete(key)
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  } finally {
    db.close()
  }
}

/** 清空全部缓存。仅用于测试与需要彻底重置的场景。 */
export async function clearImageBlobs(): Promise<void> {
  bumpCacheGeneration()
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
      tx.objectStore(META_STORE).clear()
      tx.objectStore(BLOB_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}
