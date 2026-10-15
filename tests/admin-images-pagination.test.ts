// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AdminImagesViewPanel from '../src/components/admin/AdminImagesViewPanel.vue'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'
import type { AdminImageItem, AdminImageStorageOverview } from '../src/types/admin'

const { adminApiJsonMock } = vi.hoisted(() => ({ adminApiJsonMock: vi.fn() }))

vi.mock('../src/composables/useAdminApi', () => ({
  adminApiJson: adminApiJsonMock,
}))

function image(id: string): AdminImageItem {
  return {
    id,
    userId: 'user-1',
    prompt: 'a cat',
    model: 'gpt-image-2',
    visibility: 'public',
    fundingSource: 'free',
    size: '1024x1024',
    storageLocation: 'cos',
    storageKey: 'k',
    storageBytes: 1024,
    creditCost: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
  } as AdminImageItem
}

const storageOverview: AdminImageStorageOverview = {
  totalImages: 1,
  totalBytes: 1024,
  totalCreditCost: 1,
  byLocation: [],
  storageFailureCount: 0,
  privateImageCount: 0,
}

const mounted: Array<{ unmount: () => void }> = []
/** 服务端 30 张、每页 24:第二页只有 6 张,是修复前完全够不到的那一页。 */
const TOTAL = 30
const PAGE_SIZE = 24

function listUrl(call: unknown[]) {
  return String(call[0])
}

function requestedOffset(url: string) {
  return Number(new URL(url, 'http://x').searchParams.get('offset'))
}

function mountPanel() {
  const wrapper = mount(AdminImagesViewPanel as never, {
    props: { allowWrite: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

/**
 * 等待 DOM 更新的预算。
 *
 * vi.waitFor 默认只给 1000ms，而实测在满载时（16 核跑满 worker）单次面板渲染
 * 可以到 1.4s——已经超出默认上限，此前能过只是轮询先命中。显式给足预算，避免
 * 在更慢的 CI 机器上变成偶发红灯；真正卡住时仍然会失败，不会变成无限等待。
 */
const DOM_WAIT = { timeout: 5000, interval: 20 }

/**
 * 本文件的用例预算。
 *
 * 每条都要 mount 整个 AdminImagesPanel（32 个传递依赖）并建一次 jsdom 环境，
 * 实测单独跑最慢一条 0.4s、整个文件 4.5s；而开发机上常驻的 MCP 服务持续占核时，
 * 同一条会涨到 1.8s 以上，偶发越过默认 5s。给足预算而不是拆用例：超时说明的是
 * 「机器忙」，不是「分页逻辑坏了」。真卡死时仍会失败。
 */
const CASE_TIMEOUT = 20_000

/**
 * 等到服务端返回的**条数**真正渲染到面板上。
 *
 * 判据是「范围文本里出现了 TOTAL」，不能只判「非空」：面板首帧就会渲染范围标签，
 * 此时 total 还是 0、内容是「共 0 张」——非空，但数据并没到。用非空做判据会让
 * flush 在响应回来之前就返回，后面的断言读到上一轮的状态，测试照样是时序相关的。
 */
async function flush(
  wrapper: { find: (selector: string) => { exists: () => boolean, text: () => string } },
  options: { expectRows?: boolean } = {},
) {
  await vi.waitFor(() => expect(adminApiJsonMock).toHaveBeenCalled(), DOM_WAIT)
  await nextTick()
  // 有一条用例故意把首次请求挂起（要验「旧响应不覆盖新响应」），那时数据永远不会
  // 上屏，等条数会死等——这条路径只需确认请求已发出。
  if (options.expectRows === false) return
  await vi.waitFor(
    // 用 TOTAL 而不是「非空」：空态标签（共 0 张）也是非空的。
    () => expect(wrapper.find('[data-slot="admin-images-range"]').text()).toContain(String(TOTAL)),
    DOM_WAIT,
  )
}


describe('admin image list paginates instead of hiding rows past the first page', () => {
  beforeEach(() => {
    while (mounted.length) mounted.pop()!.unmount()
    document.body.innerHTML = ''
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/images?')) {
        const offset = requestedOffset(url)
        const size = Math.max(0, Math.min(PAGE_SIZE, TOTAL - offset))
        return {
          images: Array.from({ length: size }, (_, index) => image(`img-${offset + index}`)),
          total: TOTAL,
        }
      }
      if (url === '/api/admin/images/storage-overview') return { overview: storageOverview }
      throw new Error(`unexpected request: ${url}`)
    })
  })

  it('shows the server total rather than the current page size', async () => {
    const wrapper = mountPanel()
    await flush(wrapper)

    // 修复前这里渲染 images.length,也就是 24,会被误读成「一共只有 24 张」。
    const heading = wrapper.find('[data-slot="admin-images-total"]')
    expect(heading.text()).toBe(String(TOTAL))

    const range = wrapper.find('[data-slot="admin-images-range"]')
    expect(range.text()).toContain('1')
    expect(range.text()).toContain('24')
    expect(range.text()).toContain('30')
    expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('1')
  }, CASE_TIMEOUT)

  it('reaches the second page and reports the remaining rows', async () => {
    const wrapper = mountPanel()
    await flush(wrapper)

    await wrapper.find('[data-slot="admin-images-next"]').trigger('click')

    // 等第二页的范围文本，而不是「发出了 offset=24 的请求」：请求发出但响应未回时
    // 读到的还是第一页的 1-24，断言会看到过时数据。范围文本里出现 25 才说明这一页
    // 真的渲染出来了。
    await vi.waitFor(
      () => expect(wrapper.find('[data-slot="admin-images-range"]').text()).toContain('25'),
      DOM_WAIT,
    )

    // 第二页真的发出了 offset=24 的请求,并显示了第 25-30 张。
    const offsets = adminApiJsonMock.mock.calls.map(call => requestedOffset(listUrl(call))).filter(n => !Number.isNaN(n))
    expect(offsets).toContain(PAGE_SIZE)
    expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('2')
    const range = wrapper.find('[data-slot="admin-images-range"]')
    expect(range.text()).toContain('30')
    expect(wrapper.find('[data-slot="admin-images-next"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-slot="admin-images-previous"]').attributes('disabled')).toBeUndefined()
  }, CASE_TIMEOUT)

  it('disables previous on the first page', async () => {
    const wrapper = mountPanel()
    await flush(wrapper)

    expect(wrapper.find('[data-slot="admin-images-previous"]').attributes('disabled')).toBeDefined()
  }, CASE_TIMEOUT)

  it('returns to the first page when a filter changes', async () => {
    const wrapper = mountPanel()
    await flush(wrapper)

    await wrapper.find('[data-slot="admin-images-next"]').trigger('click')
    // 用范围文本确认第二页真的渲染了：页码会随 offset 先变，不能单独作为
    // 「这一页的数据已到」的判据。
    await vi.waitFor(
      () => expect(wrapper.find('[data-slot="admin-images-range"]').text()).toContain('25'),
      DOM_WAIT,
    )

    // 在第 2 页改筛选:必须回到第 1 页,否则很容易落到空页看起来像查无结果。
    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    panel.vm.$emit('update:visibilityFilter', 'private')
    panel.vm.$emit('refresh')
    await vi.waitFor(
      () => expect(wrapper.find('[data-slot="admin-images-range"]').text()).toContain('1-24'),
      DOM_WAIT,
    )
  }, CASE_TIMEOUT)

  it('clears the selection when the page changes', async () => {
    const wrapper = mountPanel()
    await flush(wrapper)

    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    panel.vm.$emit('update:selectedIds', ['img-0', 'img-1'])
    await nextTick()
    expect(wrapper.find('[data-slot="admin-images-total"]').exists()).toBe(true)

    await wrapper.find('[data-slot="admin-images-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('2'), DOM_WAIT)

    // 跨页残留勾选会造成误删,换页必须清空。
    expect(wrapper.findComponent({ name: 'AdminImagesPanel' }).props('selectedIds')).toEqual([])
  }, CASE_TIMEOUT)
})


/**
 * 旧请求晚于新请求返回时必须被丢弃:否则切换筛选后界面会显示上一组数据,
 * 用户还可能对着这些行执行批量归档/删除。
 */
describe('admin image list drops responses superseded by a newer request', () => {
  type ListResult = { images: AdminImageItem[]; total: number }
  const pendingRequests: Array<{ promise: Promise<ListResult>; resolve: (value: ListResult) => void }> = []

  beforeEach(() => {
    while (mounted.length) mounted.pop()!.unmount()
    document.body.innerHTML = ''
    pendingRequests.length = 0
    adminApiJsonMock.mockReset()
    // 列表请求挂起不返回,由用例决定谁先 resolve;其余请求照常应答。
    adminApiJsonMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/images?')) {
        let resolve!: (value: ListResult) => void
        const promise = new Promise<ListResult>(r => { resolve = r })
        pendingRequests.push({ promise, resolve })
        return promise
      }
      if (url === '/api/admin/images/storage-overview') return Promise.resolve({ overview: storageOverview })
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
  })

  it('ignores an older response that resolves after a newer one', async () => {
    const wrapper = mountPanel()
    // 首次请求被故意挂起，不会有数据上屏。
    await flush(wrapper, { expectRows: false })

    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    // 第一次筛选请求还挂着,第二次刷新就发出了;修复前这里会被 imagesLoading 守卫挡掉,只发一次请求。
    panel.vm.$emit('update:visibilityFilter', 'private')
    panel.vm.$emit('refresh')
    await vi.waitFor(() => expect(pendingRequests.length).toBe(2), DOM_WAIT)

    // 新请求先返回,旧请求后返回:列表必须保持新请求的结果。
    pendingRequests[1].resolve({ images: [image('fresh')], total: 1 })
    await nextTick()
    await nextTick()
    pendingRequests[0].resolve({ images: [image('stale-1'), image('stale-2')], total: TOTAL })
    await nextTick()
    await nextTick()

    expect(wrapper.find('[data-slot="admin-images-total"]').text()).toBe('1')
    expect(panel.props('images')).toEqual([image('fresh')])
  }, CASE_TIMEOUT)
})
