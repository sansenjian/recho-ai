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

export async function getAuthAccessToken() {
  const client = await authClientOrNull()
  if (!client) return null

  const { data, error } = await client.auth.getSession()
  if (error) {
    console.warn('[auth] session read failed', error.message)
    return null
  }

  return data.session?.access_token || null
}

export function useAuthSession() {
  const userEmail = computed(() => user.value?.email || '')

  async function initAuth() {
    const client = await authClientOrNull()
    if (!client) {
      isAuthReady.value = true
      return
    }

    const { data } = await client.auth.getSession()
    user.value = data.session?.user || null
    client.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user || null
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
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        user.value = data.user || null
        authNotice.value = '账号已创建，请查看邮箱完成验证。'
        return true
      }

      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
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
    signOut,
  }
}
