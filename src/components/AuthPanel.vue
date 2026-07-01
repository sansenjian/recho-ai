<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { LogIn, X, Zap, Eye, EyeOff, LogOut } from '@lucide/vue'
import { useAuthSession } from '../composables/useAuthSession'
import { useCredits } from '../composables/useCredits'
import { formatCreditAmount } from '../utils/credit-format'

type AuthMode = 'signIn' | 'signUp'

const props = defineProps<{
  modelValue?: boolean
  initialMode?: AuthMode
  redirectPath?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const {
  user,
  userEmail,
  authError,
  authNotice,
  isAuthLoading,
  submitAuth,
  signInWithGitHub,
  signOut,
} = useAuthSession()

const {
  creditBalance,
  isLoadingCredits,
  isRedeemingCredits,
  creditError,
  creditNotice,
  redeemCredits,
} = useCredits()

const authMode = ref<AuthMode>(props.initialMode ?? 'signIn')
const emailDraft = ref(userEmail.value)
const passwordDraft = ref('')
const redeemCodeDraft = ref('')
const showPassword = ref(false)
const touched = ref({ email: false, password: false, redeem: false })
const dialogRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
let restoreFocusElement: HTMLElement | null = null

const creditBalanceLabel = computed(() => (
  isLoadingCredits.value && creditBalance.value === null
    ? '...'
    : formatCreditAmount(creditBalance.value)
))

const emailError = computed(() => {
  if (!touched.value.email && !emailDraft.value) return ''
  const value = emailDraft.value.trim()
  if (!value) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '请输入有效的邮箱地址'
  return ''
})

const passwordError = computed(() => {
  if (!touched.value.password && !passwordDraft.value) return ''
  const value = passwordDraft.value
  if (!value) return '请输入密码'
  if (authMode.value === 'signUp' && value.length < 6) return '密码至少需要 6 位'
  return ''
})

const redeemError = computed(() => {
  if (!touched.value.redeem && !redeemCodeDraft.value) return ''
  if (!redeemCodeDraft.value.trim()) return '请输入兑换码'
  return ''
})

const canSubmitAuth = computed(() => {
  return !emailError.value && !passwordError.value && emailDraft.value.trim() && passwordDraft.value
})

const canSubmitRedeem = computed(() => {
  return !redeemError.value && redeemCodeDraft.value.trim()
})

const isAuthView = computed(() => !user.value)
const authTitle = computed(() => user.value ? '账号' : (authMode.value === 'signIn' ? '登录' : '创建账号'))
const authSubtitle = computed(() => user.value
  ? '管理你的 Recho 账号'
  : (authMode.value === 'signIn' ? '继续使用 Recho，开始你的 AI 创作之旅' : '创建一个 Recho 账号'))

watch(userEmail, (next) => {
  if (next && emailDraft.value !== next) emailDraft.value = next
})

watch(() => props.modelValue, (open) => {
  if (open) {
    restoreFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    authMode.value = props.initialMode ?? 'signIn'
    passwordDraft.value = ''
    showPassword.value = false
    touched.value = { email: false, password: false, redeem: false }
    nextTick(() => {
      const firstField = dialogRef.value?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), [href], textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
      firstField?.focus()
    })
  } else if (restoreFocusElement && document.contains(restoreFocusElement)) {
    restoreFocusElement.focus()
    restoreFocusElement = null
  }
})

watch(user, (next, prev) => {
  if (!next && prev) {
    authMode.value = 'signIn'
  }
})

function switchMode(mode: AuthMode) {
  authMode.value = mode
  passwordDraft.value = ''
  showPassword.value = false
  touched.value = { ...touched.value, password: false }
}

function close() {
  emit('update:modelValue', false)
  emit('close')
  nextTick(() => {
    if (restoreFocusElement && document.contains(restoreFocusElement)) {
      restoreFocusElement.focus()
    }
    restoreFocusElement = null
  })
}

async function handleAuthSubmit() {
  touched.value = { ...touched.value, email: true, password: true }
  if (!canSubmitAuth.value) return

  const ok = await submitAuth(authMode.value, emailDraft.value.trim(), passwordDraft.value)
  if (ok && authMode.value === 'signIn') {
    passwordDraft.value = ''
  }
}

async function handleGitHubAuth() {
  await signInWithGitHub(props.redirectPath || '/image')
}

async function handleSignOut() {
  await signOut()
  authMode.value = 'signIn'
}

async function handleRedeem() {
  touched.value = { ...touched.value, redeem: true }
  if (!canSubmitRedeem.value) return
  const ok = await redeemCredits(redeemCodeDraft.value)
  if (ok) {
    redeemCodeDraft.value = ''
    touched.value = { ...touched.value, redeem: false }
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key !== 'Tab' || !dialogRef.value) {
    return
  }

  const focusable = Array.from(dialogRef.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(element => !element.hasAttribute('disabled') && element.offsetParent !== null)

  if (!focusable.length) {
    e.preventDefault()
    dialogRef.value.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === dialogRef.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div
    class="auth-overlay"
    @click.self="close"
    @keydown="onKeydown"
  >
    <section ref="dialogRef" class="auth-card" role="dialog" aria-modal="true" :aria-label="authTitle" tabindex="-1">
      <!-- Close button -->
      <button
        ref="closeButtonRef"
        class="close-btn"
        type="button"
        aria-label="关闭"
        @click="close"
      >
        <X :size="16" />
      </button>

      <!-- Header -->
      <div class="auth-header">
        <div class="brand-mark">
          <Zap :size="16" class="brand-icon" />
        </div>
        <div class="brand-text">
          <h1 class="auth-title">{{ authTitle }}</h1>
          <p class="auth-subtitle">{{ authSubtitle }}</p>
        </div>
      </div>

      <!-- Auth panel -->
      <Transition name="panel" mode="out-in">
        <div v-if="isAuthView" key="auth" class="panel">
          <form class="auth-form" @submit.prevent="handleAuthSubmit">
            <label class="field-group">
              <span class="field-label">邮箱</span>
              <input
                v-model="emailDraft"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                class="field-input"
                :class="{ error: emailError }"
                @blur="touched.email = true"
              />
              <span v-if="emailError" class="field-error">{{ emailError }}</span>
            </label>

            <label class="field-group">
              <span class="field-label">密码</span>
              <div class="pw-wrapper">
                <input
                  v-model="passwordDraft"
                  :type="showPassword ? 'text' : 'password'"
                  :autocomplete="authMode === 'signIn' ? 'current-password' : 'new-password'"
                  :placeholder="authMode === 'signIn' ? '输入密码' : '至少 6 位'"
                  class="field-input"
                  :class="{ error: passwordError }"
                  @blur="touched.password = true"
                />
                <button
                  type="button"
                  class="pw-toggle"
                  aria-label="切换密码可见性"
                  @click="showPassword = !showPassword"
                >
                  <EyeOff v-if="showPassword" :size="16" />
                  <Eye v-else :size="16" />
                </button>
              </div>
              <span v-if="passwordError" class="field-error">{{ passwordError }}</span>
            </label>

            <p v-if="authError && (touched.email || touched.password || isAuthLoading)" class="form-error">{{ authError }}</p>
            <p v-else-if="authNotice && (touched.email || touched.password || isAuthLoading)" class="form-notice">{{ authNotice }}</p>

            <button type="submit" class="btn btn-primary" :disabled="isAuthLoading">
              {{ isAuthLoading ? '处理中...' : (authMode === 'signIn' ? '登录' : '创建账号') }}
            </button>

            <div class="divider"><span>或</span></div>

            <button
              type="button"
              class="btn btn-secondary"
              :disabled="isAuthLoading"
              @click="handleGitHubAuth"
            >
              <LogIn :size="16" />
              {{ authMode === 'signIn' ? '使用 GitHub 登录' : '使用 GitHub 注册' }}
            </button>

            <p class="footer-link">
              {{ authMode === 'signIn' ? '没有账号？' : '已有账号？' }}
              <button type="button" class="link" @click="switchMode(authMode === 'signIn' ? 'signUp' : 'signIn')">
                {{ authMode === 'signIn' ? '创建一个' : '去登录' }}
              </button>
            </p>
          </form>
        </div>

        <!-- Profile panel -->
        <div v-else key="profile" class="panel">
          <div class="profile-stack">
            <div class="profile-card">
              <div class="profile-info">
                <div class="profile-avatar">
                  {{ userEmail?.charAt(0)?.toUpperCase() || 'R' }}
                </div>
                <div class="profile-meta">
                  <div class="profile-name">Recho User</div>
                  <div class="profile-email">{{ userEmail }}</div>
                </div>
              </div>
              <div class="credit-row">
                <span class="credit-label">余额</span>
                <span class="credit-value">{{ creditBalanceLabel }}</span>
              </div>
            </div>

            <div class="redeem-group">
              <span class="field-label">兑换码</span>
              <div class="redeem-row">
                <input
                  v-model="redeemCodeDraft"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="输入兑换码"
                  class="field-input"
                  :class="{ error: redeemError }"
                  :disabled="isRedeemingCredits"
                  @blur="touched.redeem = true"
                  @keydown.enter="handleRedeem"
                />
                <button
                  type="button"
                  class="btn btn-primary"
                  :disabled="isRedeemingCredits || !canSubmitRedeem"
                  @click="handleRedeem"
                >
                  {{ isRedeemingCredits ? '兑换中' : '兑换' }}
                </button>
              </div>
              <span v-if="redeemError" class="field-error">{{ redeemError }}</span>
              <p v-if="creditNotice" class="form-notice">{{ creditNotice }}</p>
              <p v-if="creditError" class="form-error">{{ creditError }}</p>
            </div>

            <button type="button" class="btn btn-secondary" :disabled="isAuthLoading" @click="handleSignOut">
              <LogOut :size="14" />
              退出登录
            </button>
          </div>
        </div>
      </Transition>
    </section>
  </div>
</template>

<style scoped>
.auth-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 220;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(16px);
  animation: overlayIn 0.2s ease-out;
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.auth-card {
  position: relative;
  width: 100%;
  max-width: 400px;
  background: #ffffff;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: 2rem 2rem 1.5rem;
  color: hsl(var(--card-foreground));
  box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.12);
  animation: cardIn 0.25s ease-out;
}

@keyframes cardIn {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.close-btn {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  border: none;
  background: none;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.close-btn:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.auth-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  background: hsl(var(--foreground));
  border-radius: var(--radius);
  flex-shrink: 0;
}

.brand-icon {
  color: hsl(var(--primary-foreground));
}

.brand-text {
  min-width: 0;
}

.auth-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.025em;
  margin: 0 0 0.125rem;
  white-space: nowrap;
  color: hsl(var(--foreground));
}

.auth-subtitle {
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
  margin: 0;
}

.panel {
  width: 100%;
}

.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.panel-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.panel-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.auth-form {
  display: grid;
  gap: 1rem;
}

.field-group {
  display: grid;
  gap: 0.375rem;
}

.field-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.field-input {
  width: 100%;
  height: 2.5rem;
  padding: 0 0.875rem;
  font-size: 0.8125rem;
  font-family: inherit;
  color: hsl(var(--foreground));
  background: #f9fafb;
  border: 1px solid #d1d5db;
  border-radius: var(--radius);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.field-input::placeholder {
  color: hsl(var(--muted-foreground));
}

.field-input:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 2px hsl(var(--ring));
}

.field-input.error {
  border-color: hsl(var(--destructive));
  box-shadow: 0 0 0 2px hsl(var(--destructive) / 0.2);
}

.field-error {
  font-size: 0.75rem;
  color: hsl(var(--destructive));
}

.form-error {
  font-size: 0.8125rem;
  color: hsl(var(--destructive));
  line-height: 1.4;
  margin: 0;
}

.form-notice {
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
  line-height: 1.4;
  margin: 0;
}

.pw-wrapper {
  position: relative;
}

.pw-toggle {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.15s;
}

.pw-toggle:hover {
  color: hsl(var(--foreground));
}

.pw-wrapper .field-input {
  padding-right: 2.75rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  height: 2.5rem;
  padding: 0 1rem;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  border-radius: var(--radius);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  outline: none;
}

.btn:focus-visible {
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.3);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-secondary {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  border-color: hsl(var(--border));
}

.btn-secondary:hover:not(:disabled) {
  background: hsl(var(--muted));
}

.divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 0.25rem 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: hsl(var(--border));
}

.divider span {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
}

.footer-link {
  text-align: center;
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
  margin: 0.25rem 0 0;
}

.footer-link .link {
  color: hsl(var(--foreground));
  text-decoration: none;
  font-weight: 500;
  transition: opacity 0.15s;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: inherit;
}

.footer-link .link:hover {
  opacity: 0.7;
}

.profile-stack {
  display: grid;
  gap: 1.25rem;
}

.profile-card {
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: 1rem;
}

.profile-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.profile-avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: hsl(var(--foreground));
  color: hsl(var(--primary-foreground));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 600;
  flex-shrink: 0;
}

.profile-meta {
  min-width: 0;
}

.profile-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-email {
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
  line-height: 1.3;
  margin-top: 0.125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.credit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid hsl(var(--border));
  margin-top: 0.75rem;
  padding-top: 0.75rem;
}

.credit-label {
  font-size: 0.8125rem;
  color: hsl(var(--muted-foreground));
}

.credit-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  font-family: var(--font-mono);
  letter-spacing: -0.02em;
}

.redeem-group {
  display: grid;
  gap: 0.375rem;
}

.redeem-group .field-label {
  margin-bottom: 0.125rem;
}

.redeem-row {
  display: flex;
  gap: 0.5rem;
}

.redeem-row .field-input {
  flex: 1;
  min-width: 0;
}

.redeem-row .btn {
  width: auto;
  padding: 0 1.25rem;
}

/* Mobile adaptation */
@media (max-width: 640px) {
  .auth-overlay {
    align-items: flex-end;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: none;
  }

  .auth-card {
    max-width: none;
    padding: 1.5rem 1.25rem 1.25rem;
    border-radius: calc(var(--radius) + 0.25rem);
    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .auth-title {
    font-size: 1.125rem;
  }

  .btn {
    height: 2.75rem;
  }

  .redeem-row .btn {
    height: 2.5rem;
  }
}

@media (max-width: 380px) {
  .auth-card {
    padding: 1.25rem 1rem 1rem;
  }

  .auth-header {
    gap: 0.625rem;
  }

  .brand-mark {
    width: 2.25rem;
    height: 2.25rem;
  }
}
</style>
