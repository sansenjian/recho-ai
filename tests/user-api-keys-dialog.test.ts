// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../src/i18n'

const fetchMock = vi.fn()

// 身份 ref 必须跨组件调用保持同一个:弹窗靠 watch 它的变化来关闭自己。
const session = vi.hoisted(() => ({ setUser: null as null | ((value: { id: string } | null) => void) }))

vi.mock('../src/composables/useAuthSession', async () => {
  const { ref } = await import('vue')
  const user = ref<{ id: string } | null>({ id: 'user-1' })
  session.setUser = (value) => { user.value = value }
  return {
    useAuthSession: () => ({
      user,
      userEmail: ref(''),
      authError: ref(''),
      authNotice: ref(''),
      isAuthLoading: ref(false),
      submitAuth: vi.fn(),
      signInWithGitHub: vi.fn(),
      signOut: vi.fn(),
    }),
    getAuthAccessToken: vi.fn(async () => 'token'),
  }
})

import UserApiKeysDialog from '../src/components/UserApiKeysDialog.vue'

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response
}

const createdKey = {
  id: 'k1',
  name: 'recho-cli',
  key_hint: 'sk-...abc',
  enabled: true,
  revoked_at: null,
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

function mountDialog(open = true) {
  return mount(UserApiKeysDialog, {
    props: { open },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function currentDialog(): HTMLElement {
  const dialog = document.body.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('dialog 未渲染')
  return dialog as HTMLElement
}

beforeEach(() => {
  session.setUser?.({ id: 'user-1' })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => jsonResponse({ keys: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
  document.body.innerHTML = ''
})

describe('UserApiKeysDialog', () => {
  it('renders the key panel inside a dialog', async () => {
    mountDialog()
    await settle()

    const dialog = currentDialog()
    expect(dialog.querySelector('[data-slot="api-keys-dialog"]')).not.toBeNull()
    // 标题与描述由弹窗提供,面板自身不再重复渲染。
    expect(dialog.textContent).toContain('API 密钥')
    expect(dialog.querySelectorAll('form').length).toBe(1)
  })

  it('issues a key through POST /api/api-keys and shows the plaintext once', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ keys: [] }))
      .mockImplementationOnce(async () => jsonResponse({ key: 'sk-live-abc' }))
      .mockImplementationOnce(async () => jsonResponse({ keys: [createdKey] }))

    const wrapper = mountDialog()
    await settle()

    const dialog = currentDialog()
    const input = dialog.querySelector('input') as HTMLInputElement
    input.value = 'recho-cli'
    input.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const form = dialog.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit'))
    await settle()
    await wrapper.vm.$nextTick()

    const post = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'POST')
    expect(post).toBeTruthy()
    expect((post![1] as RequestInit).body).toBe(JSON.stringify({ name: 'recho-cli' }))
    expect((post![1] as RequestInit).cache).toBe('no-store')
    expect(dialog.textContent).toContain('sk-live-abc')
  })

  it('deletes a revoked key and drops it from the list', async () => {
    const revokedKey = { ...createdKey, id: 'k2', revoked_at: '2026-01-02T00:00:00Z' }
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ keys: [revokedKey] }))
      .mockImplementationOnce(async () => jsonResponse({ ok: true }))

    const wrapper = mountDialog()
    await settle()

    const dialog = currentDialog()
    // 撤销后才会出现删除入口;未撤销的 key 只有撤销按钮。
    const removeButton = Array.from(dialog.querySelectorAll("button")).find(
      button => button.textContent?.trim() === "删除",
    ) as HTMLButtonElement | undefined
    expect(removeButton).toBeTruthy()
    removeButton!.click()
    await settle()
    await wrapper.vm.$nextTick()

    const purge = fetchMock.mock.calls.find(call => String(call[0]).endsWith('/purge'))
    expect(purge).toBeTruthy()
    expect((purge![1] as RequestInit).method).toBe('DELETE')
    expect(dialog.textContent).not.toContain('sk-...abc')
    expect(dialog.textContent).toContain('密钥已删除')
  })

  it('closes itself when the signed-in identity ends', async () => {
    // 明文密钥留在打开的弹窗里,退出登录后不能还让下一个人读到。
    const wrapper = mountDialog()
    await settle()
    expect(currentDialog()).toBeTruthy()

    session.setUser?.(null)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('emits update:open with false when the dialog closes', async () => {
    const wrapper = mountDialog()
    await settle()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})

import ChatHeader from '../src/components/ChatHeader.vue'
import { AGENT_MODES } from '../src/types'

function mountHeader(authEmail: string) {
  return mount(ChatHeader, {
    props: {
      showSidebar: false,
      showAgentPanel: false,
      showImagePanel: true,
      imageWorkspace: 'canvas' as const,
      agentMode: AGENT_MODES[0],
      messages: [],
      authEmail,
      authReady: true,
      authLoading: false,
      canUseChat: true,
      isCheckingChatAccess: false,
    },
    global: { plugins: [i18n] },
  })
}

describe('ChatHeader API key entry', () => {
  it('exposes a key button only for signed-in users', async () => {
    const signedIn = mountHeader('someone@example.com')
    const button = signedIn.find('button[title="API 密钥"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(signedIn.emitted('openApiKeys')).toHaveLength(1)

    const signedOut = mountHeader('')
    expect(signedOut.find('button[title="API 密钥"]').exists()).toBe(false)
  })
})
