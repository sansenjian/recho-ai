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
    //
    // 这里要验的是顺序，不只是「触发过」：wrapper.emitted() 按事件名分组，
    // 看不出跨事件的先后，所以要靠 attrs 上的监听器自己记录调用次序。
    adminApiJsonMock.mockResolvedValue({ adminUsers: [], adminAccess: access })
    const order: string[] = []
    const wrapper = mount(AdminUserRulesPanel, {
      props: {
        rules: [],
        access,
        canManage: true,
        loading: false,
        onClear: () => order.push('clear'),
        onNotice: () => order.push('notice'),
        onError: () => order.push('error'),
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
      },
    })

    await wrapper.find('#admin-user-email').setValue('ops@example.test')
    await wrapper.find('form').trigger('submit')

    expect(order[0]).toBe('clear')
    expect(order).toContain('notice')
  })


  it('ignores a second toggle while the first request is in flight', async () => {
    // actionId 只能记住最后一个：放任并发会让先完成的请求在 finally 里把它清空，
    // 另一条规则还没回来，按钮就已经可以再点一次。
    const ruleA: AdminUserRule = {
      id: 'rule-a', userId: null, email: 'a@example.test', role: 'operator',
      source: 'database', enabled: false, note: null, updatedAt: null,
    }
    const ruleB: AdminUserRule = {
      id: 'rule-b', userId: null, email: 'b@example.test', role: 'operator',
      source: 'database', enabled: false, note: null, updatedAt: null,
    }
    let release: (() => void) | null = null
    adminApiJsonMock.mockImplementation(() => new Promise(resolve => {
      release = () => resolve({ adminUsers: [], adminAccess: access })
    }))
    const wrapper = mountPanel([ruleA, ruleB])
    const vm = wrapper.vm as unknown as { toggleRule: (rule: AdminUserRule) => void }

    vm.toggleRule(ruleA)
    vm.toggleRule(ruleB)

    // 第二个请求不该发出去。
    expect(adminApiJsonMock).toHaveBeenCalledTimes(1)
    release?.()
    await vi.waitFor(() => {
      expect(adminApiJsonMock).toHaveBeenCalledTimes(1)
    })
  })

  it('allows the next toggle once the previous one finished', async () => {
    const rule: AdminUserRule = {
      id: 'rule-1', userId: null, email: 'ops@example.test', role: 'operator',
      source: 'database', enabled: false, note: null, updatedAt: null,
    }
    adminApiJsonMock.mockResolvedValue({ adminUsers: [], adminAccess: access })
    const wrapper = mountPanel([rule])
    const vm = wrapper.vm as unknown as { toggleRule: (rule: AdminUserRule) => void }

    await vm.toggleRule(rule)
    await vm.toggleRule(rule)

    expect(adminApiJsonMock).toHaveBeenCalledTimes(2)
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
