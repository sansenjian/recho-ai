<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import { DEFAULT_AUTH_REDIRECT_PATH, safeSameOriginPath } from '../utils/authRedirect'

type ConfirmState = 'verifying' | 'success' | 'error'
type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

const state = ref<ConfirmState>('verifying')
const title = ref('正在确认邮箱')
const message = ref('请稍等，Recho 正在确认这封验证邮件。')
const nextPath = ref(DEFAULT_AUTH_REDIRECT_PATH)
let redirectTimer: ReturnType<typeof window.setTimeout> | null = null

const templateLink = computed(() => {
  return '<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">确认邮箱</a>'
})

const stateLabel = computed(() => {
  if (state.value === 'success') return '验证成功'
  if (state.value === 'error') return '验证失败'
  return '验证中'
})

function parseAuthParams() {
  const url = new URL(window.location.href)
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hash)

  return {
    tokenHash: url.searchParams.get('token_hash') || hashParams.get('token_hash'),
    type: url.searchParams.get('type') || hashParams.get('type'),
    next: url.searchParams.get('next') || hashParams.get('next'),
    error: url.searchParams.get('error_description') ||
      hashParams.get('error_description') ||
      url.searchParams.get('error') ||
      hashParams.get('error'),
  }
}

function normalizeEmailOtpType(value: string | null): EmailOtpType {
  if (value && EMAIL_OTP_TYPES.has(value as EmailOtpType)) {
    return value as EmailOtpType
  }
  return 'email'
}

function cleanConfirmUrl() {
  window.history.replaceState({}, document.title, '/auth/confirm')
}

function finishWithError(errorMessage: string) {
  cleanConfirmUrl()
  state.value = 'error'
  title.value = '邮箱验证失败'
  message.value = errorMessage
}

async function confirmEmail() {
  const params = parseAuthParams()
  nextPath.value = safeSameOriginPath(params.next)

  if (params.error) {
    finishWithError(params.error)
    return
  }

  if (!params.tokenHash) {
    finishWithError('验证链接缺少 token_hash，请从最新的验证邮件重新打开。')
    return
  }

  try {
    const client = await getSupabaseClient()
    const { error } = await client.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: normalizeEmailOtpType(params.type),
    })

    if (error) throw error

    cleanConfirmUrl()
    state.value = 'success'
    title.value = '邮箱验证成功'
    message.value = '账号已经确认，马上进入 Recho。'
    redirectTimer = window.setTimeout(() => {
      window.location.replace(nextPath.value)
    }, 900)
  } catch (err) {
    finishWithError(err instanceof Error ? err.message : '验证失败，请重新发送验证邮件后再试。')
  }
}

function goHome() {
  window.location.assign(nextPath.value)
}

onMounted(() => {
  void confirmEmail()
})

onUnmounted(() => {
  if (redirectTimer) window.clearTimeout(redirectTimer)
})
</script>

<template>
  <main class="auth-confirm-page">
    <section class="auth-confirm-card" aria-live="polite">
      <div class="auth-confirm-status" :class="state">
        <span>{{ stateLabel }}</span>
      </div>

      <h1>{{ title }}</h1>
      <p>{{ message }}</p>

      <div class="auth-confirm-actions">
        <button
          v-if="state !== 'verifying'"
          type="button"
          class="auth-confirm-primary"
          @click="goHome"
        >
          进入 Recho
        </button>
      </div>

      <aside class="auth-confirm-template">
        <span>Supabase Confirm signup 模板链接</span>
        <code>{{ templateLink }}</code>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.auth-confirm-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--bg);
  color: var(--text-primary);
}

.auth-confirm-card {
  width: min(560px, 100%);
  display: grid;
  gap: 16px;
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-md);
}

.auth-confirm-status {
  width: max-content;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 900;
}

.auth-confirm-status.success {
  border-color: rgba(22, 163, 74, 0.28);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.auth-confirm-status.error {
  border-color: rgba(220, 38, 38, 0.24);
  background: rgba(220, 38, 38, 0.08);
  color: var(--danger);
}

.auth-confirm-card h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: 0;
}

.auth-confirm-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.auth-confirm-actions {
  min-height: 40px;
}

.auth-confirm-primary {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--accent);
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.auth-confirm-template {
  display: grid;
  gap: 8px;
  margin-top: 6px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.auth-confirm-template span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 900;
}

.auth-confirm-template code {
  display: block;
  overflow-x: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #0f172a;
  color: #e2e8f0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .auth-confirm-page {
    padding: 16px;
  }

  .auth-confirm-card {
    padding: 22px;
  }
}
</style>
