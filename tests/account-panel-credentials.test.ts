// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../src/i18n/en'
import zh from '../src/i18n/zh'

const mocks = vi.hoisted(() => ({
  submitAuth: vi.fn(async () => true),
  redeemCredits: vi.fn(async () => true),
  // 组件内部用 watch 订阅这些字段,所以必须是真正的 ref,并且测试要能拿到它们;
  // 否则 Vue 会以 Invalid watch source 告警,订阅也会静默失效。
  session: null as null | Record<string, { value: unknown }>,
  credits: null as null | Record<string, { value: unknown }>,
}))

vi.mock('../src/composables/useAuthSession', async () => {
  const { ref } = await import('vue')
  const api = {
    user: ref<{ user_metadata?: Record<string, unknown> } | null>(null),
    userEmail: ref(''),
    authError: ref(''),
    authNotice: ref(''),
    isAuthLoading: ref(false),
    submitAuth: mocks.submitAuth,
    signInWithGitHub: vi.fn(),
    signOut: vi.fn(),
  }
  mocks.session = api as unknown as Record<string, { value: unknown }>
  return { useAuthSession: () => api, getAuthAccessToken: vi.fn(async () => null) }
})

vi.mock('../src/composables/useCredits', async () => {
  const { ref } = await import('vue')
  const api = {
    creditBalance: ref(0),
    isLoadingCredits: ref(false),
    isRedeemingCredits: ref(false),
    creditError: ref(''),
    creditNotice: ref(''),
    redeemCredits: mocks.redeemCredits,
  }
  mocks.credits = api as unknown as Record<string, { value: unknown }>
  return { useCredits: () => api }
})

import AuthPanel from '../src/components/AuthPanel.vue'

const i18n = createI18n({ legacy: false, locale: 'zh', fallbackLocale: 'en', messages: { en, zh } })

type Session = NonNullable<typeof mocks.session>

function session(): Session {
  if (!mocks.session) throw new Error('useAuthSession mock 未被加载')
  return mocks.session
}

function mountPanel(initialMode: 'signIn' | 'signUp' = 'signIn') {
  return mount(AuthPanel, {
    props: { modelValue: true, initialMode },
    global: { plugins: [i18n] },
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
    session().user.value = null
    session().userEmail.value = ''
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
    const wrapper = mountPanel()
    const email = wrapper.find('input[type="email"]').element as HTMLInputElement
    expect(email.placeholder).toBe('you@example.com')
    wrapper.unmount()
  })

  it('keeps the password when the attempt fails', async () => {
    mocks.submitAuth.mockResolvedValue(false)
    const wrapper = mountPanel()
    await fillCredentials(wrapper)

    await wrapper.find('form').trigger('submit')
    await flush()

    expect(passwordValue(wrapper)).toBe('secret123')
    wrapper.unmount()
  })

  it('clears the password when switching between sign in and sign up', async () => {
    const wrapper = mountPanel()
    await fillCredentials(wrapper)

    await wrapper.find('form .mt-1 button').trigger('click')
    await flush()

    expect(passwordValue(wrapper)).toBe('')
    wrapper.unmount()
  })
})

describe('AuthPanel display name', () => {
  beforeEach(() => {
    mocks.submitAuth.mockReset()
    mocks.submitAuth.mockResolvedValue(true)
    session().userEmail.value = 'a@example.com'
  })

  afterEach(() => {
    document.body.innerHTML = ''
    session().user.value = null
  })

  // 选择器要专指资料视图里的名字:header 的 h1 同样带 .truncate,不能只按 .truncate 取。
  function nameText(wrapper: ReturnType<typeof mountPanel>) {
    return wrapper.find('[role="dialog"] .truncate.text-sm').text()
  }

  /**
   * `full_name ?? name` 在 full_name 是空字符串时会选中空串,资料页因此回落到默认名。
   * 必须逐个字段确认非空。
   */
  it('falls back to name when full_name is an empty string', async () => {
    session().user.value = { user_metadata: { full_name: '   ', name: 'Alice' } }
    const wrapper = mountPanel()
    await flush()
    expect(nameText(wrapper)).toBe('Alice')
    // header 的图标块也是 .bg-foreground,用 AvatarFallback 独有的 text-primary-foreground 区分。
    expect(wrapper.find('[role="dialog"] .bg-foreground.text-primary-foreground').text()).toBe('A')
    wrapper.unmount()
  })

  it('prefers full_name when it is present', async () => {
    session().user.value = { user_metadata: { full_name: 'Bob', name: 'Alice' } }
    const wrapper = mountPanel()
    await flush()
    expect(nameText(wrapper)).toBe('Bob')
    wrapper.unmount()
  })

  it('falls back to the localized default when neither field has a value', async () => {
    session().user.value = { user_metadata: { full_name: '', name: '' } }
    const wrapper = mountPanel()
    await flush()
    expect(nameText(wrapper)).toBe('Recho 用户')
    wrapper.unmount()
  })
})

describe('AuthPanel focus across the view switch', () => {
  beforeEach(() => {
    mocks.submitAuth.mockReset()
    session().user.value = null
    session().userEmail.value = 'user@example.com'
  })

  afterEach(() => {
    document.body.innerHTML = ''
    session().user.value = null
  })

  /**
   * mode="out-in" 会在登录成功后先移除表单再插入资料视图;被移除的节点若持有焦点,
   * 焦点会掉到 body,遮罩上的 onKeydown 也就收不到 Tab,Tab 陷印失效。
   * 视图切换后焦点必须仍然留在 dialog 内部。
   */
  it('keeps focus inside the dialog after a successful sign in swaps the view', async () => {
    mocks.submitAuth.mockImplementation(async () => {
      session().user.value = { user_metadata: {} }
      return true
    })
    const wrapper = mountPanel()
    await fillCredentials(wrapper)
    const dialog = wrapper.find('[role="dialog"]').element

    const password = wrapper.find('#auth-password').element as HTMLInputElement
    password.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)

    await wrapper.find('form').trigger('submit')
    await flush()
    await flush()

    expect(mocks.submitAuth).toHaveBeenCalled()
    expect(dialog.contains(document.activeElement)).toBe(true)
    wrapper.unmount()
  })
})
