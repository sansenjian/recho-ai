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
const DB_VERSION = 1
const STORE = 'blobs'

/**
 * 缓存条目。
 *
 * size 单独存一份是为了淘汰时不必把 blob 读出来量大小——IndexedDB 的游标只能拿到
 * 主键，算总占用得靠记录里的字段。
 */
interface CachedBlob {
  key: string
  blob: Blob
  size: number
  /** 最近一次被用到的时间，淘汰按它排序。 */
  usedAt: number
}

/** 总容量上限；超过后按最久未用淘汰。 */
export const IMAGE_BLOB_CACHE_LIMIT_BYTES = 200 * 1024 * 1024

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
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        // 淘汰要按 usedAt 排序，建索引避免每次全量读出来再排。
        store.createIndex('usedAt', 'usedAt')
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
    const entry = await new Promise<CachedBlob | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as CachedBlob | undefined)
      req.onerror = () => resolve(undefined)
    })
    if (!entry?.blob) return null
    // 命中即刷新使用时间，让刚看过的图不容易被淘汰。
    void touchImageBlob(db, key)
    return entry.blob
  } catch (error) {
    console.warn('[image-blob-cache] read failed', error)
    return null
  } finally {
    db.close()
  }
}

function touchImageBlob(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req = store.get(key)
      req.onsuccess = () => {
        const entry = req.result as CachedBlob | undefined
        if (entry) {
          entry.usedAt = Date.now()
          store.put(entry)
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

/** 写入缓存并在超限时淘汰。写入失败不影响调用方——缓存是尽力而为的。 */
export async function writeImageBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ key, blob, size: blob.size, usedAt: Date.now() } satisfies CachedBlob)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
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
 * 只删够为止，不整表清空：用户的图库可能有上千张，清空会让下一次浏览又全部回源。
 */
async function evictImageBlobs(db: IDBDatabase): Promise<void> {
  const entries = await new Promise<CachedBlob[]>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as CachedBlob[])
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })

  let total = entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
  if (total <= IMAGE_BLOB_CACHE_LIMIT_BYTES) return

  const oldestFirst = entries.sort((a, b) => (a.usedAt ?? 0) - (b.usedAt ?? 0))
  const doomed: string[] = []
  for (const entry of oldestFirst) {
    if (total <= IMAGE_BLOB_CACHE_LIMIT_BYTES) break
    doomed.push(entry.key)
    total -= entry.size ?? 0
  }
  if (!doomed.length) return

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const key of doomed) store.delete(key)
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
  const db = await openDb()
  if (!db) return
  const prefix = `${owner || ANONYMOUS_OWNER}:`
  try {
    const doomed = await new Promise<string[]>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).getAllKeys()
        req.onsuccess = () => resolve((req.result ?? []).map(String).filter(key => key.startsWith(prefix)))
        req.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
    if (!doomed.length) return

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        for (const key of doomed) store.delete(key)
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
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}
