import { computed, ref } from 'vue'
import { apiUrl } from '../lib/api-base'
import { publicClientErrorMessage } from '../lib/safe-error'
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
    const response = await fetch(apiUrl('/api/admin/credits/me'), {
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
    adminAccessError.value = publicClientErrorMessage(error, '当前账号没有 Chat 权限。')
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
