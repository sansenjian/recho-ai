<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import { DEFAULT_AUTH_REDIRECT_PATH, safeSameOriginPath } from '../utils/authRedirect'

type CallbackState = 'verifying' | 'success' | 'error'

const state = ref<CallbackState>('verifying')
const title = ref('正在完成 GitHub 登录')
const message = ref('请稍等，Recho 正在处理授权结果。')
const nextPath = ref(DEFAULT_AUTH_REDIRECT_PATH)
let redirectTimer: ReturnType<typeof window.setTimeout> | null = null

const stateLabel = computed(() => {
  if (state.value === 'success') return '登录成功'
  if (state.value === 'error') return '登录失败'
  return '处理中'
})

/**
 * 状态徽标的配色。
 *
 * 此前是一段手写 CSS 配三个类名，用的还是 --surface-soft / --accent-strong 这类为兼容
 * 保留的旧别名；换成 token 后与其余界面走同一条链路，改主题色不会再漏掉这一页。
 */
const stateClass = computed(() => {
  if (state.value === 'success') return 'border-accent bg-accent text-accent-foreground'
  if (state.value === 'error') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-muted text-muted-foreground'
})

function parseAuthParams() {
  const url = new URL(window.location.href)
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hash)

  return {
    code: url.searchParams.get('code') || hashParams.get('code'),
    next: url.searchParams.get('next') || hashParams.get('next'),
    error: url.searchParams.get('error_description') ||
      hashParams.get('error_description') ||
      url.searchParams.get('error') ||
      hashParams.get('error'),
  }
}

function cleanCallbackUrl() {
  window.history.replaceState({}, document.title, '/auth/callback')
}

function finishWithError(errorMessage: string) {
  cleanCallbackUrl()
  state.value = 'error'
  title.value = 'GitHub 登录失败'
  message.value = errorMessage
}

async function resolveSession() {
  const params = parseAuthParams()
  nextPath.value = safeSameOriginPath(params.next)

  if (params.error) {
    finishWithError(params.error)
    return
  }

  try {
    const client = await getSupabaseClient()

    if (params.code) {
      const { error } = await client.auth.exchangeCodeForSession(params.code)
      if (error) throw error
    }

    const { data, error } = await client.auth.getSession()
    if (error) throw error

    if (!data.session) {
      throw new Error('未能建立 GitHub 登录会话，请重新尝试。')
    }

    cleanCallbackUrl()
    state.value = 'success'
    title.value = 'GitHub 登录成功'
    message.value = '账号已经登录，马上返回 Recho。'
    redirectTimer = window.setTimeout(() => {
      window.location.replace(nextPath.value)
    }, 900)
  } catch (err) {
    finishWithError(err instanceof Error ? err.message : 'GitHub 登录失败，请重试。')
  }
}

function goHome() {
  window.location.assign(nextPath.value)
}

onMounted(() => {
  void resolveSession()
})

onUnmounted(() => {
  if (redirectTimer) window.clearTimeout(redirectTimer)
})
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-background p-4 text-foreground sm:p-6">
    <section
      class="grid w-full max-w-[560px] gap-[16px] rounded-lg border border-border bg-secondary p-[28px] max-sm:p-[22px] shadow-md"
      aria-live="polite"
    >
      <div
        class="w-max rounded-full border px-2.5 py-1 text-[12px] font-black"
        :class="stateClass"
      >
        <span>{{ stateLabel }}</span>
      </div>

      <h1 class="m-0 text-[26px] leading-[1.2]">{{ title }}</h1>
      <p class="m-0 text-[14px] text-muted-foreground">{{ message }}</p>

      <div class="min-h-[40px]">
        <button
          v-if="state !== 'verifying'"
          type="button"
          class="min-h-[40px] cursor-pointer rounded-[7px] border border-primary bg-primary px-[16px] text-[13px] font-black text-primary-foreground max-sm:min-h-[44px] max-sm:w-full"
          @click="goHome"
        >
          进入 Recho
        </button>
      </div>
    </section>
  </main>
</template>
