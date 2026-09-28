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

function image(overrides: Partial<AdminImageItem> = {}): AdminImageItem {
  return {
    id: 'img-1',
    userId: 'user-1',
    prompt: 'a cat',
    model: 'gpt-image-2',
    visibility: 'public',
    fundingSource: 'credit',
    size: '1024x1024',
    storageLocation: 'cos',
    storageKey: 'k',
    storageBytes: 1024,
    creditCost: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
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

function clickButton(label: string) {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('confirm dialog is not open')
  const button = Array.from(dialog.querySelectorAll('button')).find(
    item => item.textContent?.includes(label),
  )
  if (!button) throw new Error(`button not found: ${label}`)
  button.click()
}

/** 只保留写接口调用，列表/概览的读取请求不算数。 */
function writeCalls() {
  return adminApiJsonMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
    || (init as RequestInit | undefined)?.method === 'POST')
}

function mountPanelReadOnly() {
  const wrapper = mount(AdminImagesViewPanel as never, {
    props: { allowWrite: false },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

describe('admin image panel destructive actions ask first', () => {
  beforeEach(() => {
    while (mounted.length) mounted.pop()!.unmount()
    document.body.innerHTML = ''
    adminApiJsonMock.mockReset()
    adminApiJsonMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/images?')) return { images: [image()] }
      if (url === '/api/admin/images/storage-overview') return { overview: storageOverview }
      if (url.endsWith('/visibility')) return { image: image({ visibility: 'private' }) }
      if (url === '/api/admin/images/bulk/archive') return { images: [image({ visibility: 'private' })] }
      if (url === '/api/admin/images/bulk/delete') return { deletedIds: ['img-1'], deletedCount: 1 }
      throw new Error(`unexpected request: ${url}`)
    })
  })

  it('does not hide an image until the confirmation is accepted', async () => {
    const wrapper = mountPanel()
    await vi.waitFor(() => expect(adminApiJsonMock).toHaveBeenCalled())
    await nextTick()

    wrapper.vm.$emit
    // 直接触发子面板派发的事件，等价于用户点了「隐藏」。
    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    panel.vm.$emit('setVisibility', image(), 'private')
    await nextTick()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(writeCalls()).toHaveLength(0)

    clickButton('隐藏图片')
    await vi.waitFor(() => expect(writeCalls()).toHaveLength(1))
    expect(String(adminApiJsonMock.mock.calls.find(call => String(call[0]).endsWith('/visibility'))?.[0]))
      .toBe('/api/admin/images/img-1/visibility')
  })

  it('never reaches a write endpoint while write access is off', async () => {
    const wrapper = mountPanelReadOnly()
    await vi.waitFor(() => expect(adminApiJsonMock).toHaveBeenCalled())
    await nextTick()

    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    panel.vm.$emit('setVisibility', image(), 'private')
    panel.vm.$emit('bulkArchive')
    panel.vm.$emit('bulkDelete')
    await nextTick()

    // 只读：既不弹确认框，也不发写请求。
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(writeCalls()).toHaveLength(0)

    const toggle = wrapper.find('[data-slot="admin-write-gate-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.text()).toContain('只读')

    // 开关本身不直接改权限：它把新值交给父级，由父级回灌 allowWrite。
    await toggle.trigger('click')
    expect(wrapper.emitted('update:allowWrite')?.at(-1)).toEqual([true])
  })

  it('shows the write gate as open once write access is on', async () => {
    const wrapper = mountPanel()
    await vi.waitFor(() => expect(adminApiJsonMock).toHaveBeenCalled())
    await nextTick()

    const toggle = wrapper.find('[data-slot="admin-write-gate-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.text()).toContain('已开启')
  })

  it('leaves the image untouched when the confirmation is dismissed', async () => {
    const wrapper = mountPanel()
    await vi.waitFor(() => expect(adminApiJsonMock).toHaveBeenCalled())
    await nextTick()

    const panel = wrapper.findComponent({ name: 'AdminImagesPanel' })
    panel.vm.$emit('setVisibility', image(), 'private')
    await nextTick()
    clickButton('取消')
    await nextTick()

    expect(writeCalls()).toHaveLength(0)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
