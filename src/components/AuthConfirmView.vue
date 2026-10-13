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

const stateLabel = computed(() => {
  if (state.value === 'success') return '验证成功'
  if (state.value === 'error') return '验证失败'
  return '验证中'
})

/**
 * 状态徽标的配色。
 *
 * 此前是一段手写 CSS 配三个类名，用的还是 --surface-soft / --accent-strong 这类为兼容
 * 保留的旧别名；换成 token 后与其余界面走同一条链路，改主题色不会再漏掉这一页。
 *
 * 成功态用 --success 而不是 --accent：浅色主题下 --accent 与 --muted 同为 0 0% 96%，
 * 成功徽标会和「验证中」长得一模一样。
 */
const stateClass = computed(() => {
  if (state.value === 'success') return 'border-success/30 bg-success/10 text-success'
  if (state.value === 'error') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-muted text-muted-foreground'
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