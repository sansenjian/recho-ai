import { computed, ref } from 'vue'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { clearImageBlobsForOwner } from '../lib/image-blob-cache'
import { clearPresignedImageCache } from './usePresignedImage'
import { getSupabaseClient } from '../lib/supabase'
import i18n from '../i18n'

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
      authError.value = err instanceof Error ? err.message : i18n.global.t('account.errors.notConfigured')
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
      clearPresignedImageCache()
      authNotice.value = i18n.global.t('account.errors.emailNotConfirmed')
      return
    }

    // 会话身份变化时清掉签名缓存。签名不分账号（键只有路径），不清就会让上一个
    // 账号的私有图地址在有效期内继续可读。这里覆盖登出、切号、会话过期等所有
    // 路径——它们是同一个汇聚点。
    if ((user.value?.id || null) !== (sessionUser?.id || null)) {
      clearPresignedImageCache()
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
      authError.value = i18n.global.t('account.errors.credentialsRequired')
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
          authNotice.value = i18n.global.t('account.errors.signUpEmailNotEnforced')
          return true
        }
        user.value = null
        authNotice.value = i18n.global.t('account.errors.signUpCheckEmail')
        return true
      }

      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
      if (data.user && !isEmailConfirmed(data.user)) {
        await client.auth.signOut()
        throw new Error(i18n.global.t('account.errors.emailNotConfirmed'))
      }
      user.value = data.user || null
      authNotice.value = i18n.global.t('account.errors.signedIn')
      return true
    } catch (err) {
      authError.value = err instanceof Error ? err.message : i18n.global.t('account.errors.signInFailed')
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
      authNotice.value = i18n.global.t('account.errors.githubRedirecting')
      return true
    } catch (err) {
      authError.value = err instanceof Error ? err.message : i18n.global.t('account.errors.githubFailed')
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
      // 必须在 signOut 之前读：登出后 session 就没了，拿不到刚才是谁。
      const owner = (await getAuthIdentity()).userId
      const { error } = await client.auth.signOut()
      if (error) throw error
      user.value = null
      // 只清这个账号的缓存。清空整表会让用户换回来时又要全部重新下载，而这个
      // 账号的图本来就只该它自己看到——缓存键里已经带了 owner。
      // 签名缓存不在这里清：applySessionUser 会按身份变化统一处理。
      if (owner) void clearImageBlobsForOwner(owner)
    } catch (err) {
      authError.value = err instanceof Error ? err.message : i18n.global.t('account.errors.signOutFailed')
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
