import { computed, ref } from 'vue'
import i18n from '../i18n'
import { apiFetch, apiUrl } from '../lib/api-base'
import { adminErrorMessage } from '../utils/admin-format'
import { getAuthAccessToken } from './useAuthSession'

const isAdminReady = ref(false)
const isAdmin = ref(false)
const isCheckingAdmin = ref(false)
const adminAccessError = ref('')
let adminAccessPromise: Promise<boolean> | null = null

async function checkAdminAccess() {
  const token = await getAuthAccessToken()
  if (!token) {
    isAdmin.value = false
    isAdminReady.value = true
    adminAccessError.value = ''
    return false
  }

  isCheckingAdmin.value = true
  try {
    const response = await apiFetch(apiUrl('/api/admin/credits/me'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : response.statusText)
    }

    isAdmin.value = data?.admin === true
    adminAccessError.value = ''
    return isAdmin.value
  } catch (error) {
    isAdmin.value = false
    adminAccessError.value = adminErrorMessage(error, i18n.global.t('settings.noChatAccess'))
    return false
  } finally {
    isAdminReady.value = true
    isCheckingAdmin.value = false
  }
}

export function resetAdminAccess() {
  isAdminReady.value = false
  isAdmin.value = false
  isCheckingAdmin.value = false
  adminAccessError.value = ''
  adminAccessPromise = null
}

export function useAdminAccess() {
  async function ensureAdminAccess() {
    adminAccessPromise ??= checkAdminAccess().finally(() => {
      adminAccessPromise = null
    })
    return await adminAccessPromise
  }

  return {
    isAdminReady,
    isAdmin,
    isCheckingAdmin,
    adminAccessError,
    canUseChat: computed(() => isAdminReady.value && isAdmin.value),
    ensureAdminAccess,
    resetAdminAccess,
  }
}
