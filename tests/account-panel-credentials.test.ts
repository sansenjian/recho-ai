// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

const mocks = vi.hoisted(() => ({
  submitAuth: vi.fn(async () => true),
  redeemCredits: vi.fn(async () => true),
}))

// 组件内部用 watch 订阅这些字段,所以必须是真正的 ref,否则 Vue 会告警且订阅失效。
vi.mock('../src/composables/useAuthSession', async () => {
  const { ref } = await import('vue')
  return {
    useAuthSession: () => ({
      user: ref(null),
      userEmail: ref(''),
      authError: ref(''),
      authNotice: ref(''),
      isAuthLoading: ref(false),
      submitAuth: mocks.submitAuth,
      signInWithGitHub: vi.fn(),
      signOut: vi.fn(),
    }),
    getAuthAccessToken: vi.fn(async () => null),
  }
})

vi.mock('../src/composables/useCredits', async () => {
  const { ref } = await import('vue')
  return {
    useCredits: () => ({
      creditBalance: ref(0),
      isLoadingCredits: ref(false),
      isRedeemingCredits: ref(false),
      creditError: ref(''),
      creditNotice: ref(''),
      redeemCredits: mocks.redeemCredits,
    }),
  }
})

import AuthPanel from '../src/components/AuthPanel.vue'

const i18n = createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })

function mountPanel(initialMode: 'signIn' | 'signUp') {
  return mount(AuthPanel, {
    props: { modelValue: true, initialMode },
    global: { plugins: [i18n], stubs: { UserApiKeys: true } },
    attachTo: document.body,
  })
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function passwordValue(wrapper: ReturnType<typeof mountPanel>) {
  return (wrapper.find('#auth-password').element as HTMLInputElement).value
}

async function fillCredentials(wrapper: ReturnType<typeof mountPanel>, password = 'secret123') {
  await wrapper.find('input[type="email"]').setValue('user@example.com')
  await wrapper.find('#auth-password').setValue(password)
}

describe('AuthPanel credential drafts', () => {
  beforeEach(() => {
    mocks.submitAuth.mockReset()
    mocks.submitAuth.mockResolvedValue(true)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  /**
   * 注册成功时 submitAuth 会把 user 置空(isAuthView 仍为 true),但凭据已经提交;
   * 只按 signIn 判断会把注册后的密码留在输入框里,所以两种模式都必须清空。
   */
  it.each(['signIn', 'signUp'] as const)('clears the password after a successful %s', async (mode) => {
    const wrapper = mountPanel(mode)
    await fillCredentials(wrapper)
    expect(passwordValue(wrapper)).toBe('secret123')

    await wrapper.find('form').trigger('submit')
    await flush()

    expect(mocks.submitAuth).toHaveBeenCalledWith(mode, 'user@example.com', 'secret123')
    expect(passwordValue(wrapper)).toBe('')
    wrapper.unmount()
  })

  /**
   * vue-i18n 的消息编译器把裸 @ 当成 linked-message 起始符:`you@example.com`
   * 会在渲染时抛 Invalid linked format,整块弹窗都渲染不出来。必须写成
   * `you{'@'}example.com` 字面量。这里用真实组件挂载把这个坑钉住。
   */
  it('renders the email placeholder with a literal at-sign', async () => {
    const wrapper = mountPanel('signIn')
    const email = wrapper.find('input[type="email"]').element as HTMLInputElement
    expect(email.placeholder).toBe('you@example.com')
    wrapper.unmount()
  })

  it('keeps the password when the attempt fails', async () => {
    mocks.submitAuth.mockResolvedValue(false)
    const wrapper = mountPanel('signIn')
    await fillCredentials(wrapper)

    await wrapper.find('form').trigger('submit')
    await flush()

    expect(passwordValue(wrapper)).toBe('secret123')
    wrapper.unmount()
  })

  it('clears the password when switching between sign in and sign up', async () => {
    const wrapper = mountPanel('signIn')
    await fillCredentials(wrapper)

    await wrapper.find('form .mt-1 button').trigger('click')
    await flush()

    expect(passwordValue(wrapper)).toBe('')
    wrapper.unmount()
  })
})
