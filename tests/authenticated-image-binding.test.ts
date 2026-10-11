// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
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

async function mountImage(props: Record<string, unknown>) {
  const AuthenticatedImage = (await import('../src/components/AuthenticatedImage.vue')).default
  return mount(AuthenticatedImage, { props, attachTo: document.body })
}

describe('AuthenticatedImage source binding', () => {
  beforeEach(() => {
    // mock 是文件级共享的：不清掉调用记录，后一个用例的 not.toHaveBeenCalled
    // 会被前一个用例的调用污染。
    fetchBlob.mockReset()
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

    // 代理尚未返回时，既不该渲染 img，也不该出现远程地址。
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('cos.example')

    release('blob:test')
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('blob:test')
  })

  it('falls back to the remote url when there is no storage path', async () => {
    // 没有可代理的路径时，远程 URL 是唯一来源。
    const wrapper = await mountImage({
      source: { previewUrl: 'https://cos.example/local.webp' },
      mode: 'thumbnail',
    })
    expect(wrapper.find('img').attributes('src')).toBe('https://cos.example/local.webp')
    expect(fetchBlob).not.toHaveBeenCalled()
  })

  it('falls back to the remote url when the proxy fails', async () => {
    fetchBlob.mockRejectedValue(new Error('proxy down'))
    const wrapper = await mountImage({
      source: { storagePath: 'cos://references/x.webp', previewUrl: 'https://cos.example/x.webp' },
      mode: 'thumbnail',
    })
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).toBe('https://cos.example/x.webp')
  })

  it('renders no img at all when nothing resolves', async () => {
    // <img src=""> 会让浏览器按当前页面地址再发一次请求。
    const wrapper = await mountImage({ source: {}, mode: 'thumbnail' })
    expect(wrapper.find('img').exists()).toBe(false)
  })
})
