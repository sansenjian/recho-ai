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
  <main class="auth-callback-page">
    <section class="auth-callback-card" aria-live="polite">
      <div class="auth-callback-status" :class="state">
        <span>{{ stateLabel }}</span>
      </div>

      <h1>{{ title }}</h1>
      <p>{{ message }}</p>

      <div class="auth-callback-actions">
        <button
          v-if="state !== 'verifying'"
          type="button"
          class="auth-callback-primary"
          @click="goHome"
        >
          进入 Recho
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-callback-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--bg);
  color: var(--text-primary);
}

.auth-callback-card {
  width: min(560px, 100%);
  display: grid;
  gap: 16px;
  padding: 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-md);
}

.auth-callback-status {
  width: max-content;
  padding: 4px 9px;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 900;
}

.auth-callback-status.success {
  border-color: rgba(22, 163, 74, 0.28);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.auth-callback-status.error {
  border-color: rgba(220, 38, 38, 0.24);
  background: rgba(220, 38, 38, 0.08);
  color: var(--danger);
}

.auth-callback-card h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: 0;
}

.auth-callback-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.auth-callback-actions {
  min-height: 40px;
}

.auth-callback-primary {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid hsl(var(--primary));
  border-radius: 7px;
  background: hsl(var(--primary));
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

@media (max-width: 640px) {
  .auth-callback-page {
    padding: 16px;
  }

  .auth-callback-card {
    padding: 22px;
  }

  .auth-callback-primary {
    min-height: 44px;
    width: 100%;
  }
}
</style>
