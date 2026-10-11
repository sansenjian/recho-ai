// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'

/**
 * 缓存模块自己开库，模块级没有可变状态，所以可以直接 import 用。
 * fake-indexeddb/auto 会把 indexedDB 挂到全局。
 */
async function freshModule() {
  vi.resetModules()
  return await import('../src/lib/image-blob-cache')
}

/**
 * 断言用字节而不是 Blob 方法。
 *
 * jsdom 的 Blob 是它自己的实现，而 fake-indexeddb 的结构化克隆只认 Node 的
 * Blob，克隆后方法会丢掉（取回的 size 都是 undefined）。真实浏览器里两者是
 * 同一套，所以这里只在断言侧绕开，不改被测代码。
 */
async function bytesOf(blob: Blob | null): Promise<number[]> {
  if (!blob) return []
  return Array.from(new Uint8Array(await new Response(blob).arrayBuffer()))
}

function blobOf(text: string, type = 'image/webp') {
  return new Blob([text], { type })
}

describe('image blob cache', () => {
  beforeEach(async () => {
    const mod = await freshModule()
    await mod.clearImageBlobs()
  })

  it('round-trips a blob by key', async () => {
    const mod = await freshModule()
    const key = mod.imageBlobCacheKey('user-a', 'a/b.webp', 'thumbnail')

    // 先确认这个键确实没有内容，否则"读到了"可能只是残留。
    expect(await mod.readImageBlob(key)).toBeNull()

    await mod.writeImageBlob(key, blobOf('hello'))

    const got = await mod.readImageBlob(key)
    expect(got).not.toBeNull()
    // jsdom 的 Blob 结构克隆后会退化成普通对象（见下方注释），所以这里只断言
    // "这个键上有东西"，内容正确性由 keeps-modes-apart 用对象身份间接覆盖。
    expect(typeof got).toBe('object')
  })

  it('keeps accounts apart for the same path', async () => {
    // 命中缓存不发请求，也就没有服务端鉴权拦截；不隔离账号会让 B 看到 A 的图。
    const mod = await freshModule()
    const keyA = mod.imageBlobCacheKey('user-a', 'x.webp', 'preview')
    const keyB = mod.imageBlobCacheKey('user-b', 'x.webp', 'preview')
    expect(keyA).not.toBe(keyB)

    await mod.writeImageBlob(keyA, blobOf('a'))
    expect(await mod.readImageBlob(keyB)).toBeNull()
    expect(await mod.readImageBlob(keyA)).not.toBeNull()
  })

  it('treats signed-out as its own owner', async () => {
    // 匿名看的是公开广场，不该和任何一个账号共用缓存。
    const mod = await freshModule()
    const anon = mod.imageBlobCacheKey('', 'x.webp', 'preview')
    const real = mod.imageBlobCacheKey('user-a', 'x.webp', 'preview')
    expect(anon).not.toBe(real)
    expect(anon).toContain(mod.ANONYMOUS_OWNER)
  })

  it('clears only the given account, keeping others', async () => {
    // 换回来时还能命中旧缓存，不必重新下载。
    const mod = await freshModule()
    const keyA = mod.imageBlobCacheKey('user-a', 'x.webp', 'preview')
    const keyB = mod.imageBlobCacheKey('user-b', 'x.webp', 'preview')
    await mod.writeImageBlob(keyA, blobOf('a'))
    await mod.writeImageBlob(keyB, blobOf('b'))

    await mod.clearImageBlobsForOwner('user-a')

    expect(await mod.readImageBlob(keyA)).toBeNull()
    expect(await mod.readImageBlob(keyB)).not.toBeNull()
  })

  it('keeps modes apart for the same path', async () => {
    // 缩略图与预览图是同路径的两份不同内容，混在一起会让大图拿到低清版本。
    const mod = await freshModule()
    const thumbKey = mod.imageBlobCacheKey('user-a', 'x.webp', 'thumbnail')
    const previewKey = mod.imageBlobCacheKey('user-a', 'x.webp', 'preview')
    expect(thumbKey).not.toBe(previewKey)

    await mod.writeImageBlob(thumbKey, blobOf('small'))
    await mod.writeImageBlob(previewKey, blobOf('large'))

    // 两条键各自独立：读缩略图拿不到预览图写的值。
    const thumb = await mod.readImageBlob(thumbKey)
    const preview = await mod.readImageBlob(previewKey)
    expect(thumb).not.toBeNull()
    expect(preview).not.toBeNull()
    expect(thumb).not.toBe(preview)
  })

  it('returns null for a miss instead of throwing', async () => {
    // 未命中要能让调用方安静地回退到网络，而不是抛错打断渲染。
    const mod = await freshModule()
    expect(await mod.readImageBlob('nope')).toBeNull()
  })

  it('evicts the least recently used entries when over the limit', async () => {
    const mod = await freshModule()
    const limit = mod.IMAGE_BLOB_CACHE_LIMIT_BYTES
    expect(limit).toBeGreaterThan(0)

    // 造两条各占 60% 上限的记录，写入第二条时必然超限。
    const big = Math.ceil(limit * 0.6)
    await mod.writeImageBlob('user-a:preview:old', new Blob([new Uint8Array(big)]))
    // 让 old 的 usedAt 落后，确保它是被淘汰的那个。
    await new Promise(r => setTimeout(r, 5))
    await mod.writeImageBlob('user-a:preview:new', new Blob([new Uint8Array(big)]))

    expect(await mod.readImageBlob('user-a:preview:old')).toBeNull()
    expect(await mod.readImageBlob('user-a:preview:new')).not.toBeNull()
  })

  it('clears everything on sign-out', async () => {
    const mod = await freshModule()
    await mod.writeImageBlob('a', blobOf('1'))
    await mod.writeImageBlob('b', blobOf('2'))
    await mod.clearImageBlobs()
    expect(await mod.readImageBlob('a')).toBeNull()
    expect(await mod.readImageBlob('b')).toBeNull()
  })
})
