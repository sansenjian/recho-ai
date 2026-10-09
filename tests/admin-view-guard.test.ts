// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import AdminView from '../src/views/AdminView.vue'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

/**
 * 登录状态的可变容器。
 *
 * 真实的 ref 由 vi.mock 工厂创建后挂到 sessionState 上：vi.mock 会被提升到 import
 * 之前执行，那时 vue 还没加载完，不能在提升块里直接建 ref；而模块级 let 又晚于
 * 工厂执行，读它会得到 TDZ 报错。挂在这个对象上两条约束都绕开了。
 */
const { adminApiJsonMock, sessionState } = vi.hoisted(() => ({
  adminApiJsonMock: vi.fn(),
  sessionState: {} as {
    user?: { value: null | { id: string; email: string } }
    isAuthReady?: { value: boolean }
  },
}))

/** 取登录状态 ref；工厂执行后才有值。 */
function refs() {
  return sessionState as {
    user: { value: null | { id: string; email: string } }
    isAuthReady: { value: boolean }
  }
}

vi.mock('../src/composables/useAdminApi', () => ({ adminApiJson: adminApiJsonMock }))

vi.mock('../src/composables/useAuthSession', async () => {
  const { computed, ref } = await import('vue')
  const user = ref(null as null | { id: string; email: string })
  const isReady = ref(false)
  // 交给测试用例直接改这两个 ref。
  sessionState.user = user as never
  sessionState.isAuthReady = isReady as never
  return {
    useAuthSession: () => ({
      user,
      userEmail: computed(() => (user.value as { email?: string } | null)?.email ?? ''),
      isAuthReady: computed(() => isReady.value),
      initAuth: async () => {
        isReady.value = true
        sessionState.isAuthReady = isReady as never
      },
    }),
    getAuthAccessToken: vi.fn(async () => 'token'),
    getAuthIdentity: vi.fn(async () => ({ accessToken: 'token', userId: 'u1' })),
  }
})

function mountAdmin() {
  return mount(AdminView, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })],
      // 面板都是 defineAsyncComponent。用 stubs 而不是 vi.mock 掉它们的模块：
      // 后者会绕开 Vue 对 SFC 的编译产物，缺 __isTeleport 之类的内部标记，
      // 渲染时报「Unhandled error during execution of render function」，
      // 让整条流水线因为几个未处理错误而判红。
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        AdminOverviewPanel: true,
        AdminCreditsPanel: true,
        AdminImagesViewPanel: true,
        AdminAttemptsViewPanel: true,
        AdminSystemPanel: true,
        AdminAnnouncementsPanel: true,
        AdminApiKeysPanel: true,
        AdminSettingsPanel: true,
        AdminProviderSettingsPanel: true,
        AdminUserRulesPanel: true,
      },
    },
  })
}

/**
 * 这组用例守的是「未登录不发权限请求」与「登录后自动补查」两个行为。
 *
 * 已知覆盖盲区：真实的无限请求循环（checkAdmin → getSession → onAuthStateChange
 * → user 被赋新对象 → watch 再次触发）复现不出来——这里的 adminApiJson 是替换过的，
 * 不会真的回调 supabase 的 auth 监听。所以 watch 必须按 user.id 比较、而不是监听
 * 整个对象这件事，只有靠注释和真机验证保障，测试抓不到退回原写法。
 */
describe('admin view auth guard', () => {
  beforeEach(() => {
    adminApiJsonMock.mockReset()
    refs().isAuthReady.value = false
    refs().user.value = null
  })

  it('does not ask for permissions while logged out', async () => {
    // 未登录时 adminApiJson 会因为拿不到 token 直接抛「请先登录」，那个错误被收进
    // errorMessage 后看起来像「没权限」——排查会往权限配置上白费功夫。这里确认
    // 请求根本没发出去。
    const wrapper = mountAdmin()
    await flushPromises()

    expect(adminApiJsonMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请先登录')
  })

  it('checks permissions once the user is logged in', async () => {
    adminApiJsonMock.mockResolvedValue({ admin: true, currentAdminRole: 'operator' })
    refs().user.value = { id: 'u1', email: 'admin@example.test' }
    mountAdmin()
    await flushPromises()

    expect(adminApiJsonMock).toHaveBeenCalledWith('/api/admin/credits/me')
  })

  it('re-checks after a login that happens while the page is open', async () => {
    // 原先只在 onMounted 查一次：用户在这个页面完成登录时，user 变了但没人再查，
    // 页面会一直停在「请先登录」，非刷新不可。
    adminApiJsonMock.mockResolvedValue({ admin: true, currentAdminRole: 'operator' })
    const wrapper = mountAdmin()
    await flushPromises()
    expect(adminApiJsonMock).not.toHaveBeenCalled()

    refs().user.value = { id: 'u1', email: 'admin@example.test' } as never
    await nextTick()
    await flushPromises()

    expect(adminApiJsonMock).toHaveBeenCalledWith('/api/admin/credits/me')
    expect(wrapper.text()).not.toContain('请先登录')
  })

})
