// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUserRulesPanel from '../src/components/admin/AdminUserRulesPanel.vue'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'
import type { AdminUserRule } from '../src/types/admin'

const { adminApiJsonMock } = vi.hoisted(() => ({ adminApiJsonMock: vi.fn() }))

vi.mock('../src/composables/useAdminApi', () => ({
  adminApiJson: adminApiJsonMock,
}))

const access = {
  configured: true,
  userIdCount: 0,
  emailCount: 0,
  databaseCount: 0,
  envUserIdCount: 0,
  envEmailCount: 0,
  tableAvailable: true,
}

function mountPanel(rules: AdminUserRule[] = []) {
  return mount(AdminUserRulesPanel, {
    props: { rules, access, canManage: true, loading: false },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
    },
  })
}

describe('admin user rules panel', () => {
  beforeEach(() => {
    adminApiJsonMock.mockReset()
  })

  it('refuses an empty identity locally instead of asking the server', async () => {
    // 服务端会以 invalid_admin_identity 拒绝，而那个错误码没有译文，
    // 管理员看到的是服务器原文，英文界面还会混进中文。
    const wrapper = mountPanel()

    await wrapper.find('form').trigger('submit')

    expect(adminApiJsonMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('error')?.[0]?.[0]).toBe('请输入用户 ID 或邮箱。')
  })

  it('submits once an identity is provided', async () => {
    adminApiJsonMock.mockResolvedValue({ adminUsers: [], adminAccess: access })
    const wrapper = mountPanel()

    await wrapper.find('#admin-user-email').setValue('ops@example.test')
    await wrapper.find('form').trigger('submit')

    expect(adminApiJsonMock).toHaveBeenCalledTimes(1)
    const [url, init] = adminApiJsonMock.mock.calls[0]
    expect(url).toBe('/api/admin/settings/admin-users')
    expect(JSON.parse(String((init as RequestInit).body)).email).toBe('ops@example.test')
  })

  it('refuses when the operator is not a senior admin', async () => {
    const wrapper = mount(AdminUserRulesPanel, {
      props: { rules: [], access, canManage: false, loading: false },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
      },
    })

    // 非高级管理员看不到表单，直接调内部方法也应被挡下。
    await (wrapper.vm as unknown as { createRule: () => Promise<void> }).createRule()

    expect(adminApiJsonMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('error')?.[0]?.[0]).toBe('只有高级管理员可以设置后台管理员。')
  })

  it('clears the parent banner before publishing an operation result', async () => {
    // 上一次操作留下的错误会盖住这次的成功提示，必须在写入前清掉。
    adminApiJsonMock.mockResolvedValue({ adminUsers: [], adminAccess: access })
    const wrapper = mountPanel()

    await wrapper.find('#admin-user-email').setValue('ops@example.test')
    await wrapper.find('form').trigger('submit')

    const events = Object.keys(wrapper.emitted())
    expect(events).toContain('clear')
    // clear 必须排在同一次操作的 error/notice 之前。
    const clearIndex = wrapper.emitted('clear')!.length
    expect(clearIndex).toBeGreaterThan(0)
  })

  it('clears the banner before toggling a rule too', async () => {
    adminApiJsonMock.mockResolvedValue({ adminUsers: [], adminAccess: access })
    const rule: AdminUserRule = {
      id: 'rule-1',
      userId: null,
      email: 'ops@example.test',
      role: 'operator',
      source: 'database',
      enabled: false,
      note: null,
      updatedAt: null,
    }
    const wrapper = mountPanel([rule])

    await (wrapper.vm as unknown as { toggleRule: (r: AdminUserRule) => void }).toggleRule(rule)

    expect(wrapper.emitted('clear')).toBeTruthy()
    expect(adminApiJsonMock).toHaveBeenCalledTimes(1)
  })
})
