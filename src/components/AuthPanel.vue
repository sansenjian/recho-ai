<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LogIn, X, Zap, Eye, EyeOff, LogOut } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useAuthSession } from '../composables/useAuthSession'
import { useCredits } from '../composables/useCredits'
import { formatCreditAmount } from '../utils/credit-format'
import UserApiKeys from './UserApiKeys.vue'

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

const { t } = useI18n()

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
  if (!value) return t('account.validation.emailRequired')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return t('account.validation.emailInvalid')
  return ''
})

const passwordError = computed(() => {
  if (!touched.value.password && !passwordDraft.value) return ''
  const value = passwordDraft.value
  if (!value) return t('account.validation.passwordRequired')
  if (authMode.value === 'signUp' && value.length < 6) return t('account.validation.passwordTooShort')
  return ''
})

const redeemError = computed(() => {
  if (!touched.value.redeem && !redeemCodeDraft.value) return ''
  if (!redeemCodeDraft.value.trim()) return t('account.validation.redeemRequired')
  return ''
})

const canSubmitAuth = computed(() => {
  return !emailError.value && !passwordError.value && emailDraft.value.trim() && passwordDraft.value
})

const canSubmitRedeem = computed(() => {
  return !redeemError.value && redeemCodeDraft.value.trim()
})

const isAuthView = computed(() => !user.value)
const authTitle = computed(() => (
  user.value ? t('account.title') : (authMode.value === 'signIn' ? t('account.signIn') : t('account.signUp'))
))
const authSubtitle = computed(() => {
  if (user.value) return t('account.profileSubtitle')
  return authMode.value === 'signIn' ? t('account.signInSubtitle') : t('account.signUpSubtitle')
})
const submitLabel = computed(() => {
  if (isAuthLoading.value) return t('account.signingIn')
  return authMode.value === 'signIn' ? t('account.signIn') : t('account.signUp')
})

/** 优先用 OAuth/注册时写入的显示名,其次邮箱,最后回落到本地化的默认名。 */
const displayName = computed(() => {
  const meta = user.value?.user_metadata as Record<string, unknown> | undefined
  const fullName = meta?.full_name ?? meta?.name
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim()
  return t('account.displayName')
})

const avatarInitial = computed(() => {
  const source = user.value ? displayName.value || userEmail.value : userEmail.value
  return source?.charAt(0)?.toUpperCase() || 'R'
})

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
    passwordDraft.value = ''
  }
})

function switchMode(mode: AuthMode) {
  authMode.value = mode
  touched.value = { email: false, password: false, redeem: false }
}

function close() {
  emit('update:modelValue', false)
  emit('close')
  nextTick(() => {
    if (restoreFocusElement && document.contains(restoreFocusElement)) restoreFocusElement.focus()
  })
}

async function handleAuthSubmit() {
  touched.value = { ...touched.value, email: true, password: true }
  if (!canSubmitAuth.value) return
  await submitAuth(authMode.value, emailDraft.value, passwordDraft.value)
}

async function handleGitHubAuth() {
  await signInWithGitHub(props.redirectPath || '/image')
}

async function handleSignOut() {
  await signOut()
}

async function handleRedeem() {
  touched.value = { ...touched.value, redeem: true }
  if (!canSubmitRedeem.value) return
  await redeemCredits(redeemCodeDraft.value)
}

/**
 * 键盘语义:Esc 关闭,Tab 在弹窗内部循环,避免焦点跑到遮罩层后面。
 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialogRef.value) return

  const candidates = Array.from(dialogRef.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(element => !element.hasAttribute('disabled'))
  // jsdom 没有布局引擎,offsetParent 恒为 null;只在有布局信息时用它排除隐藏元素。
  const laidOut = candidates.filter(element => element.offsetParent !== null)
  const focusable = laidOut.length ? laidOut : candidates
  if (!focusable.length) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inside = active ? dialogRef.value.contains(active) : false

  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault()
      last.focus()
    }
    return
  }
  if (!inside || active === last) {
    e.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Transition
    appear
    enter-active-class="transition-opacity duration-200 ease-out"
    enter-from-class="opacity-0"
    appear-active-class="transition-opacity duration-200 ease-out"
    appear-from-class="opacity-0"
  >
    <div
      class="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[16px] max-sm:items-end max-sm:bg-black/55 max-sm:p-3 max-sm:backdrop-blur-none"
      @click.self="close"
      @keydown="onKeydown"
    >
      <Transition
        appear
        enter-active-class="transition-[opacity,transform] duration-[250ms] ease-out"
        enter-from-class="opacity-0 translate-y-2 scale-[0.985]"
        appear-active-class="transition-[opacity,transform] duration-[250ms] ease-out"
        appear-from-class="opacity-0 translate-y-2 scale-[0.985]"
      >
        <section
          ref="dialogRef"
          class="relative max-h-[calc(100dvh-2rem)] w-full max-w-[400px] overflow-y-auto overscroll-contain rounded-lg border border-border bg-card px-8 pt-8 pb-6 text-card-foreground shadow-[0_24px_48px_-12px_rgba(0,0,0,0.12)] outline-none max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:max-w-none max-sm:rounded-[calc(var(--radius)+0.25rem)] max-sm:px-5 max-sm:pt-6 max-sm:pb-5"
          role="dialog"
          aria-modal="true"
          :aria-label="authTitle"
          tabindex="-1"
        >
          <!-- Close button -->
          <button
            ref="closeButtonRef"
            class="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            type="button"
            :aria-label="t('common.close')"
            @click="close"
          >
            <X :size="16" />
          </button>

          <!-- Header -->
          <div class="mb-6 flex items-center gap-3 max-sm:gap-2.5">
            <div class="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground max-sm:size-9">
              <Zap :size="16" class="text-primary-foreground" />
            </div>
            <div class="min-w-0">
              <h1 class="mb-0.5 truncate text-xl font-semibold tracking-tight text-foreground max-sm:text-lg">{{ authTitle }}</h1>
              <p class="m-0 text-[0.8125rem] text-muted-foreground">{{ authSubtitle }}</p>
            </div>
          </div>

          <!-- Auth panel -->
          <Transition
            mode="out-in"
            enter-active-class="transition-[opacity,transform] duration-[180ms] ease-out"
            leave-active-class="transition-[opacity,transform] duration-[180ms] ease-in"
            enter-from-class="opacity-0 translate-y-1"
            leave-to-class="opacity-0 -translate-y-0.5"
          >
            <div v-if="isAuthView" key="auth" class="w-full">
              <form class="grid gap-4" @submit.prevent="handleAuthSubmit">
                <label class="grid gap-1.5">
                  <span class="block text-[0.8125rem] font-medium tracking-tight text-foreground">{{ t('account.email') }}</span>
                  <Input
                    v-model="emailDraft"
                    type="email"
                    autocomplete="email"
                    :placeholder="t('account.emailPlaceholder')"
                    class="h-10 rounded-lg bg-muted px-3.5 text-[0.8125rem]"
                    :aria-invalid="emailError ? 'true' : undefined"
                    @blur="touched.email = true"
                  />
                  <span v-if="emailError" class="text-xs text-destructive">{{ emailError }}</span>
                </label>

                <label class="grid gap-1.5">
                  <span id="auth-password-label" class="block text-[0.8125rem] font-medium tracking-tight text-foreground">{{ t('account.password') }}</span>
                  <div class="relative">
                    <Input
                      id="auth-password"
                      aria-labelledby="auth-password-label"
                      v-model="passwordDraft"
                      :type="showPassword ? 'text' : 'password'"
                      :autocomplete="authMode === 'signIn' ? 'current-password' : 'new-password'"
                      :placeholder="authMode === 'signIn' ? t('account.passwordPlaceholderSignIn') : t('account.passwordPlaceholderSignUp')"
                      class="h-10 rounded-lg bg-muted px-3.5 pr-11 text-[0.8125rem]"
                      :aria-invalid="passwordError ? 'true' : undefined"
                      @blur="touched.password = true"
                    />
                    <button
                      type="button"
                      class="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                      :aria-label="t('account.togglePasswordVisibility')"
                      @click="showPassword = !showPassword"
                    >
                      <EyeOff v-if="showPassword" :size="16" />
                      <Eye v-else :size="16" />
                    </button>
                  </div>
                  <span v-if="passwordError" class="text-xs text-destructive">{{ passwordError }}</span>
                </label>

                <p v-if="authError && (touched.email || touched.password || isAuthLoading)" class="m-0 text-[0.8125rem] leading-snug text-destructive">{{ authError }}</p>
                <p v-else-if="authNotice && (touched.email || touched.password || isAuthLoading)" class="m-0 text-[0.8125rem] leading-snug text-muted-foreground">{{ authNotice }}</p>

                <Button type="submit" class="h-10 w-full rounded-lg text-[0.8125rem] font-medium max-sm:h-11" :disabled="isAuthLoading">
                  {{ submitLabel }}
                </Button>

                <div class="my-1 flex items-center gap-4">
                  <Separator class="flex-1" />
                  <span class="shrink-0 text-xs text-muted-foreground">{{ t('account.or') }}</span>
                  <Separator class="flex-1" />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  class="h-10 w-full rounded-lg text-[0.8125rem] font-medium max-sm:h-11"
                  :disabled="isAuthLoading"
                  @click="handleGitHubAuth"
                >
                  <LogIn :size="16" />
                  {{ authMode === 'signIn' ? t('account.githubSignIn') : t('account.githubSignUp') }}
                </Button>

                <p class="mt-1 text-center text-[0.8125rem] text-muted-foreground">
                  {{ authMode === 'signIn' ? t('account.noAccount') : t('account.hasAccount') }}
                  <button type="button" class="cursor-pointer border-0 bg-none p-0 font-medium text-foreground hover:opacity-70" @click="switchMode(authMode === 'signIn' ? 'signUp' : 'signIn')">
                    {{ authMode === 'signIn' ? t('account.toSignUp') : t('account.toSignIn') }}
                  </button>
                </p>
              </form>
            </div>

            <!-- Profile panel -->
            <div v-else key="profile" class="w-full">
              <div class="grid gap-5">
                <div class="rounded-lg border border-border bg-muted p-4">
                  <div class="flex items-center gap-3">
                    <Avatar class="size-10">
                      <AvatarFallback class="bg-foreground text-sm font-semibold text-primary-foreground">{{ avatarInitial }}</AvatarFallback>
                    </Avatar>
                    <div class="min-w-0">
                      <div class="truncate text-sm leading-tight font-semibold text-foreground">{{ displayName }}</div>
                      <div class="mt-0.5 truncate text-[0.8125rem] leading-tight text-muted-foreground">{{ userEmail }}</div>
                    </div>
                  </div>
                  <div class="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <span class="text-[0.8125rem] text-muted-foreground">{{ t('account.balance') }}</span>
                    <span class="font-mono text-sm font-semibold tracking-tight text-foreground">{{ creditBalanceLabel }}</span>
                  </div>
                </div>

                <div class="grid gap-1.5">
                  <label class="block text-[0.8125rem] font-medium tracking-tight text-foreground" for="redeem-code">{{ t('account.redeemCode') }}</label>
                  <div class="flex gap-2">
                    <Input
                      id="redeem-code"
                      v-model="redeemCodeDraft"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      :placeholder="t('account.redeemPlaceholder')"
                      class="h-10 min-w-0 flex-1 rounded-lg bg-muted px-3.5 text-[0.8125rem]"
                      :aria-invalid="redeemError ? 'true' : undefined"
                      :disabled="isRedeemingCredits"
                      @blur="touched.redeem = true"
                      @keydown.enter="handleRedeem"
                    />
                    <Button
                      type="button"
                      class="h-10 w-auto rounded-lg px-5 text-[0.8125rem] font-medium max-sm:h-10"
                      :disabled="isRedeemingCredits || !canSubmitRedeem"
                      @click="handleRedeem"
                    >
                      {{ isRedeemingCredits ? t('account.redeeming') : t('account.redeem') }}
                    </Button>
                  </div>
                  <span v-if="redeemError" class="text-xs text-destructive">{{ redeemError }}</span>
                  <p v-if="creditNotice" class="m-0 text-[0.8125rem] leading-snug text-muted-foreground">{{ creditNotice }}</p>
                  <p v-if="creditError" class="m-0 text-[0.8125rem] leading-snug text-destructive">{{ creditError }}</p>
                </div>

                <UserApiKeys />

                <Button type="button" variant="outline" class="h-10 w-full rounded-lg text-[0.8125rem] font-medium max-sm:h-11" :disabled="isAuthLoading" @click="handleSignOut">
                  <LogOut :size="14" />
                  {{ t('account.signOut') }}
                </Button>
              </div>
            </div>
          </Transition>
        </section>
      </Transition>
    </div>
  </Transition>
</template>
