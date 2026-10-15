// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 取图真实实现，但把网络请求换成可控的桩：这里要验证的是"什么时候绑 src"，
 * 而不是代理本身怎么工作。
 */
const fetchBlob = vi.fn()
vi.mock('../src/lib/authenticated-image-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/authenticated-image-source')>()
  return {
    ...actual,
    fetchAuthenticatedImageObjectUrl: (...args: unknown[]) => fetchBlob(...args),
  }
})

/**
 * 签发地址也要打桩。
 *
 * 不打桩的话组件会真的去请求 cos.example——那是真实网络调用，要等 DNS 和超时。
 * 本文件验的是「什么时候绑 src」，与签发服务无关；漏了这一桩会让用例在并发或
 * 慢网络下直接撞上 5s 测试超时（实测全量运行时约三次里失败一次）。
 * 默认返回 null，即"签发不可用"，组件因此落回代理分支——正是这些用例要观察的路径。
 */
const presign = vi.fn(async () => null)
vi.mock('../src/composables/usePresignedImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/composables/usePresignedImage')>()
  return {
    ...actual,
    requestPresignedImageUrl: (...args: unknown[]) => presign(...(args as [])),
  }
})

/**
 * 挂载组件，并让挂载副作用推进一轮。
 *
 * 用 `nextTick` 而不是 `flushPromises`：本文件有「故意挂起代理」的用例（用永不
 * resolve 的 Promise 观察取回前的状态），而 flushPromises 要等到微任务队列清空
 * ——在这种用例上会一直卡着，把 1 秒的用例拖到超时。nextTick 只推进 Vue 的渲染
 * 队列，不等那些永远不会兑现的 promise。
 */
async function mountImage(props: Record<string, unknown>) {
  const AuthenticatedImage = (await import('../src/components/AuthenticatedImage.vue')).default
  const wrapper = mount(AuthenticatedImage, { props, attachTo: document.body })
  await nextTick()
  return wrapper
}

/**
 * 本文件的用例预算。
 *
 * 每条都要 mount 一个组件并建一次 jsdom 环境，实测单独跑 0.7–1.6s（空 jsdom 文件
 * 本身就要 1.2s），而默认上限是 5s。开发机上常驻的 MCP 服务会持续占核，实测同一
 * 条用例在争用时能到 5.1s——刚好越过上限，表现为「时过时不过」。
 *
 * 这里给足预算而不是拆小用例：超时失败说明的只是「机器忙」，不是「取图逻辑坏了」，
 * 把它变成红灯只会训练人忽略这个信号。真正卡死时仍会失败，不会无限等待。
 */
const CASE_TIMEOUT = 20_000

describe('AuthenticatedImage source binding', () => {
  beforeEach(() => {
    // mock 是文件级共享的：不清掉调用记录，后一个用例的 not.toHaveBeenCalled
    // 会被前一个用例的调用污染。
    fetchBlob.mockReset()
    presign.mockReset()
    presign.mockResolvedValue(null)
  })


  it('does not bind a remote url while a storage path can be proxied', async () => {
    // 带 storagePath 时先绑远程 URL 会发出一次必然失败的请求（对象存储有防盗链），
    // 403 会出现在控制台，用户还会看到一闪而过的裂图。
    // 用挂起的 Promise 把代理卡住，才能观察到"取回之前"这一瞬间的状态。
    let release: (value: string) => void = () => {}
    fetchBlob.mockReturnValue(new Promise<string>((resolve) => { release = resolve }))

    const wrapper = await mountImage({
      source: { storagePath: 'cos://references/x.webp', previewUrl: 'https://cos.example/x.webp' },
      src: 'https://cos.example/x.webp',
      mode: 'thumbnail',
    })

    // 必须等组件真的走到代理这一步，release 才有意义。
    //
    // mount 返回时 watcher 还停在 `await requestPresignedImageUrl` 上，release 此时
    // 仍是初始的空函数——调用它是空操作，真 promise 永远挂着，而下面的断言会因为
    // 「什么都没渲染」而**恰好通过**：这条用例此前就是在假通过，从没验到取回之后那一步。
    await vi.waitFor(() => expect(fetchBlob).toHaveBeenCalled(), { timeout: 5000, interval: 10 })

    // 代理尚未返回时，既不该渲染 img，也不该出现远程地址。
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('cos.example')

    release('blob:test')
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('blob:test')
  }, CASE_TIMEOUT)

  it('falls back to the remote url when there is no storage path', async () => {
    // 没有可代理的路径时，远程 URL 是唯一来源。
    const wrapper = await mountImage({
      source: { previewUrl: 'https://cos.example/local.webp' },
      mode: 'thumbnail',
    })
    expect(wrapper.find('img').attributes('src')).toBe('https://cos.example/local.webp')
    expect(fetchBlob).not.toHaveBeenCalled()
  }, CASE_TIMEOUT)

  it('falls back to the remote url when the proxy fails', async () => {
    fetchBlob.mockRejectedValue(new Error('proxy down'))
    const wrapper = await mountImage({
      source: { storagePath: 'cos://references/x.webp', previewUrl: 'https://cos.example/x.webp' },
      mode: 'thumbnail',
    })
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('https://cos.example/x.webp')
  }, CASE_TIMEOUT)

  it('falls back to the proxy when the presigned url fails to load', async () => {
    // 签发成功不等于能加载：对象可能已删除、存储可能 403、签名也可能在长时间
    // 挂起的页面上过期。没有这一步，这些情况都会留下永久裂图。
    vi.resetModules()
    const presign = vi.fn().mockResolvedValue({ url: 'https://cos.example/expired.webp', expiresAt: 0 })
    vi.doMock('../src/composables/usePresignedImage', () => ({
      requestPresignedImageUrl: presign,
      fetchPresignedImageUrls: async () => new Map(),
    }))
    fetchBlob.mockResolvedValue('blob:proxy-fallback')

    const AuthenticatedImage = (await import('../src/components/AuthenticatedImage.vue')).default
    const wrapper = mount(AuthenticatedImage, {
      props: { source: { storagePath: 'cos://x.webp' }, mode: 'thumbnail' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('https://cos.example/expired.webp')

    // 模拟浏览器加载失败。
    await wrapper.find('img').trigger('error')
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('blob:proxy-fallback')

    vi.doUnmock('../src/composables/usePresignedImage')
    vi.resetModules()
  }, CASE_TIMEOUT)

  it('does not loop when the proxy url itself fails', async () => {
    // 只有当前显示的是签名地址时才补救，否则代理地址失败会反复触发。
    vi.resetModules()
    vi.doMock('../src/composables/usePresignedImage', () => ({
      requestPresignedImageUrl: vi.fn().mockResolvedValue(null),
      fetchPresignedImageUrls: async () => new Map(),
    }))
    fetchBlob.mockResolvedValue('blob:proxy')

    const AuthenticatedImage = (await import('../src/components/AuthenticatedImage.vue')).default
    const wrapper = mount(AuthenticatedImage, {
      props: { source: { storagePath: 'cos://x.webp' }, mode: 'thumbnail' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('blob:proxy')

    const callsBefore = fetchBlob.mock.calls.length
    await wrapper.find('img').trigger('error')
    await flushPromises()
    // 代理地址失败不该再触发一轮代理请求。
    expect(fetchBlob.mock.calls.length).toBe(callsBefore)

    vi.doUnmock('../src/composables/usePresignedImage')
    vi.resetModules()
  }, CASE_TIMEOUT)

  it('renders no img at all when nothing resolves', async () => {
    // <img src=""> 会让浏览器按当前页面地址再发一次请求。
    const wrapper = await mountImage({ source: {}, mode: 'thumbnail' })
    expect(wrapper.find('img').exists()).toBe(false)
  }, CASE_TIMEOUT)
})
