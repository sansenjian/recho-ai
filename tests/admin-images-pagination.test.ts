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

async function flush() {
  await vi.waitFor(() => expect(adminApiJsonMock).toHaveBeenCalled())
  await nextTick()
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
    await flush()

    // 修复前这里渲染 images.length,也就是 24,会被误读成「一共只有 24 张」。
    const heading = wrapper.find('[data-slot="admin-images-total"]')
    expect(heading.text()).toBe(String(TOTAL))

    const range = wrapper.find('[data-slot="admin-images-range"]')
    expect(range.text()).toContain('1')
    expect(range.text()).toContain('24')
    expect(range.text()).toContain('30')
    expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('1')
  })

  it('reaches the second page and reports the remaining rows', async () => {
    const wrapper = mountPanel()
    await flush()

    await wrapper.find('[data-slot="admin-images-next"]').trigger('click')
    await vi.waitFor(() => {
      const offsets = adminApiJsonMock.mock.calls.map(call => requestedOffset(listUrl(call))).filter(n => !Number.isNaN(n))
      expect(offsets).toContain(PAGE_SIZE)
    })
    await nextTick()

    // 第二页真的发出了 offset=24 的请求,并显示了第 25-30 张。
    expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('2')
    const range = wrapper.find('[data-slot="admin-images-range"]')
    expect(range.text()).toContain('25')
    expect(range.text()).toContain('30')
    expect(wrapper.find('[data-slot="admin-images-next"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-slot="admin-images-previous"]').attributes('disabled')).toBeUndefined()
  })

  it('disables previous on the first page', async () => {
    const wrapper = mountPanel()
    await flush()

    expect(wrapper.find('[data-slot="admin-images-previous"]').attributes('disabled')).toBeDefined()
  })

  it('returns to the first page when a filter changes', async () => {
    const wrapper = mountPanel()
    await flush()

    await wrapper.find('[data-slot="admin-images-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('2'))

    // 在第 2 页改筛选:必须回到第 1 页,否则很容易落到空页看起来像查无结果。
    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    panel.vm.$emit('update:visibilityFilter', 'private')
    panel.vm.$emit('refresh')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('1'))
  })

  it('clears the selection when the page changes', async () => {
    const wrapper = mountPanel()
    await flush()

    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    panel.vm.$emit('update:selectedIds', ['img-0', 'img-1'])
    await nextTick()
    expect(wrapper.find('[data-slot="admin-images-total"]').exists()).toBe(true)

    await wrapper.find('[data-slot="admin-images-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="admin-images-page-number"]').text()).toContain('2'))

    // 跨页残留勾选会造成误删,换页必须清空。
    expect(wrapper.findComponent({ name: 'AdminImagesPanel' }).props('selectedIds')).toEqual([])
  })
})
