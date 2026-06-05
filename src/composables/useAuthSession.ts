import { computed, ref } from 'vue'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '../lib/supabase'

type AuthMode = 'signIn' | 'signUp'

const user = ref<User | null>(null)
const authError = ref<string | null>(null)
const authNotice = ref<string | null>(null)
const isAuthReady = ref(false)
const isAuthLoading = ref(false)
let authClient: SupabaseClient | null = null
let authInitPromise: Promise<SupabaseClient | null> | null = null

async function authClientOrNull() {
  if (authClient) return authClient

  authInitPromise ??= getSupabaseClient()
    .then((client) => {
      authClient = client
      return client
    })
    .catch((err) => {
      authError.value = err instanceof Error ? err.message : 'Supabase Auth 尚未配置'
      return null
    })

  return await authInitPromise
}

export async function getAuthIdentity() {
  const client = await authClientOrNull()
  if (!client) return { accessToken: null, userId: null }

  const { data, error } = await client.auth.getSession()
  if (error) {
    console.warn('[auth] session read failed', error.message)
    return { accessToken: null, userId: null }
  }

  return {
    accessToken: data.session?.access_token || null,
    userId: data.session?.user?.id || null,
  }
}

export async function getAuthAccessToken() {
  const identity = await getAuthIdentity()
  return identity.accessToken
}

export function useAuthSession() {
  const userEmail = computed(() => user.value?.email || '')

  function isEmailConfirmed(authUser: User) {
    if (!authUser.email) return true
    return Boolean(authUser.email_confirmed_at || authUser.confirmed_at)
  }

  async function applySessionUser(client: SupabaseClient, sessionUser: User | null) {
    if (sessionUser && !isEmailConfirmed(sessionUser)) {
      await client.auth.signOut()
      user.value = null
      authNotice.value = '请先完成邮箱验证后再登录。'
      return
    }

    user.value = sessionUser
  }

  async function initAuth() {
    const client = await authClientOrNull()
    if (!client) {
      isAuthReady.value = true
      return
    }

    const { data } = await client.auth.getSession()
    await applySessionUser(client, data.session?.user || null)
    client.auth.onAuthStateChange((_event, session) => {
      void applySessionUser(client, session?.user || null)
    })
    isAuthReady.value = true
  }

  async function submitAuth(mode: AuthMode, email: string, password: string) {
    authError.value = null
    authNotice.value = null

    if (!email.trim() || !password) {
      authError.value = '请输入邮箱和密码'
      return false
    }

    const client = await authClientOrNull()
    if (!client) return false

    isAuthLoading.value = true
    try {
      if (mode === 'signUp') {
        const emailAddress = email.trim()
        const { data, error } = await client.auth.signUp({
          email: emailAddress,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        })
        if (error) throw error
        if (data.session) {
          await client.auth.signOut()
          user.value = null
          authNotice.value = '账号已创建，但当前 Supabase 项目没有强制邮箱验证，请在 Supabase Auth 开启 Confirm email。'
          return true
        }
        user.value = null
        authNotice.value = '账号已创建，请查看邮箱完成验证。'
        return true
      }

      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
      if (data.user && !isEmailConfirmed(data.user)) {
        await client.auth.signOut()
        throw new Error('请先完成邮箱验证后再登录。')
      }
      user.value = data.user || null
      authNotice.value = '已登录'
      return true
    } catch (err) {
      authError.value = err instanceof Error ? err.message : '账号操作失败'
      return false
    } finally {
      isAuthLoading.value = false
    }
  }

  async function signInWithGitHub(nextPath = '/image') {
    authError.value = null
    authNotice.value = null

    const client = await authClientOrNull()
    if (!client) return false

    isAuthLoading.value = true
    try {
      const redirectTo = new URL('/auth/callback', window.location.origin)
      redirectTo.searchParams.set('next', nextPath || '/image')

      const { error } = await client.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: redirectTo.toString(),
          // Supabase's GitHub provider requests user:email; add read:user for profile metadata.
          scopes: 'read:user',
        },
      })

      if (error) throw error
      authNotice.value = '正在跳转到 GitHub 登录...'
      return true
    } catch (err) {
      authError.value = err instanceof Error ? err.message : 'GitHub 登录失败'
      return false
    } finally {
      isAuthLoading.value = false
    }
  }

  async function signOut() {
    authError.value = null
    authNotice.value = null
    const client = await authClientOrNull()
    if (!client) return

    isAuthLoading.value = true
    try {
      const { error } = await client.auth.signOut()
      if (error) throw error
      user.value = null
    } catch (err) {
      authError.value = err instanceof Error ? err.message : '退出失败'
    } finally {
      isAuthLoading.value = false
    }
  }

  return {
    user,
    userEmail,
    authError,
    authNotice,
    isAuthReady,
    isAuthLoading,
    initAuth,
    submitAuth,
    signInWithGitHub,
    signOut,
  }
}
