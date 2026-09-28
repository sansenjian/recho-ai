import { readonly, ref, watch } from 'vue'
import { apiUrl } from '../lib/api-base'
import i18n from '../i18n'
import { localizedClientErrorMessage } from '../utils/client-error-message'
import { normalizeCreditBalance } from '../utils/credit-format'
import { getAuthAccessToken, useAuthSession } from './useAuthSession'

const creditBalance = ref<number | null>(null)
const isLoadingCredits = ref(false)
const isRedeemingCredits = ref(false)
const creditError = ref<string | null>(null)
const creditNotice = ref<string | null>(null)
let refreshSeq = 0
let hasAuthWatcher = false

interface CreditBalanceResponse {
  balance?: number | null
}

interface CreditRedeemResponse extends CreditBalanceResponse {
  redeemedCredits?: number
}

export function numericBalance(value: unknown) {
  return normalizeCreditBalance(value)
}

async function readCreditError(response: Response, fallbackKey: string) {
  try {
    const data = await response.json() as { error?: unknown }
    return localizedClientErrorMessage(data.error || response.statusText, fallbackKey)
  } catch {
    return localizedClientErrorMessage(response.statusText, fallbackKey)
  }
}

export function useCredits() {
  const { user } = useAuthSession()

  function setCreditBalance(balance: unknown) {
    // Explicit null/undefined from the API means "no balance record";
    // distinguish from an actual balance of 0 by clearing the ref.
    if (balance === null || balance === undefined) {
      creditBalance.value = null
      return
    }
    const value = numericBalance(balance)
    if (value !== null) {
      creditBalance.value = value
    }
  }

  async function refreshCredits() {
    const seq = ++refreshSeq
    creditError.value = null

    const token = await getAuthAccessToken()
    if (!token) {
      creditBalance.value = null
      return null
    }

    isLoadingCredits.value = true
    try {
      const response = await fetch(apiUrl('/api/credits'), {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        return null
      }

      const data = await response.json() as CreditBalanceResponse
      if (seq === refreshSeq) {
        setCreditBalance(data.balance)
      }
      return creditBalance.value
    } catch (err) {
      if (seq === refreshSeq) {
        console.warn('[credits] balance refresh skipped:', localizedClientErrorMessage(err, 'account.errors.creditsUnavailable'))
      }
      return null
    } finally {
      if (seq === refreshSeq) {
        isLoadingCredits.value = false
      }
    }
  }

  async function redeemCredits(code: string) {
    creditError.value = null
    creditNotice.value = null

    const token = await getAuthAccessToken()
    if (!token) {
      creditError.value = i18n.global.t('account.errors.redeemLoginRequired')
      return false
    }

    if (!code.trim()) {
      creditError.value = i18n.global.t('account.errors.redeemCodeRequired')
      return false
    }

    isRedeemingCredits.value = true
    try {
      const response = await fetch(apiUrl('/api/credits/redeem'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })

      if (!response.ok) {
        creditError.value = await readCreditError(response, 'account.errors.redeemFailed')
        return false
      }

      const data = await response.json() as CreditRedeemResponse
      setCreditBalance(data.balance)
      const redeemedCredits = numericBalance(data.redeemedCredits)
      creditNotice.value = redeemedCredits !== null && redeemedCredits > 0
        ? i18n.global.t('account.errors.redeemSucceededCount', { count: redeemedCredits })
        : i18n.global.t('account.errors.redeemSucceeded')
      return true
    } catch (err) {
      creditError.value = localizedClientErrorMessage(err, 'account.errors.redeemFailed')
      return false
    } finally {
      isRedeemingCredits.value = false
    }
  }

  if (!hasAuthWatcher) {
    hasAuthWatcher = true
    watch(
      () => user.value?.id || null,
      (userId) => {
        creditError.value = null
        creditNotice.value = null
        if (userId) {
          void refreshCredits()
        } else {
          creditBalance.value = null
        }
      },
      { immediate: true },
    )
  }

  return {
    creditBalance: readonly(creditBalance),
    isLoadingCredits: readonly(isLoadingCredits),
    isRedeemingCredits: readonly(isRedeemingCredits),
    creditError: readonly(creditError),
    creditNotice: readonly(creditNotice),
    refreshCredits,
    redeemCredits,
    setCreditBalance,
  }
}
