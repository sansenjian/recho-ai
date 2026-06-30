<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AdminImageAttemptsPanel from '../components/admin/AdminImageAttemptsPanel.vue'
import AdminImagesPanel from '../components/admin/AdminImagesPanel.vue'
import { apiUrl } from '../lib/api-base'
import { publicClientErrorMessage } from '../lib/safe-error'
import { getAuthAccessToken, useAuthSession } from '../composables/useAuthSession'
import type {
  AdminAccessSummary,
  AdminAnnouncement,
  AdminAppSettings,
  AdminCode,
  AdminCodeRedemption,
  AdminImageAttemptItem,
  AdminImageAttemptOverview,
  AdminImageItem,
  AdminImageStorageOverview,
  AdminImageStorageStat,
  AdminLedgerEntry,
  AdminOverview,
  AdminProviderSetting,
  AdminProviderSettingsState,
  AdminSystemStatus,
  AdminTransaction,
  AdminRole,
  AdminUser,
  AdminUserRule,
} from '../types/admin'
import {
  dateTime,
  shortId,
  tableStatusLabel,
} from '../utils/admin-format'
import {
  formatCreditAmount,
  formatSignedCreditAmount,
  normalizeCreditBalance,
} from '../utils/credit-format'

const { t, locale } = useI18n()

const {
  user,
  userEmail,
  isAuthReady,
  initAuth,
} = useAuthSession()

// --- Sidebar & UI State ---
const activeView = ref('overview')
const sidebarCollapsed = ref(false)
const isDark = ref(false)

function toggleSidebar() { sidebarCollapsed.value = !sidebarCollapsed.value }
function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
}
function toggleLocale() { locale.value = locale.value === 'zh' ? 'en' : 'zh' }

const navItems = [
  { id: 'overview', labelKey: 'nav.overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
  { id: 'credits', labelKey: 'nav.credits', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'images', labelKey: 'nav.images', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'monitor', labelKey: 'nav.monitor', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'system', labelKey: 'nav.system', icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01' },
  { id: 'announcements', labelKey: 'nav.announcements', icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
  { id: 'settings', labelKey: 'nav.settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
]

const adminChecked = ref(false)
const isAdmin = ref(false)
const loading = ref(false)
const overviewLoading = ref(false)
const systemLoading = ref(false)
const settingsLoading = ref(false)
const settingsLoaded = ref(false)
const settingsSaving = ref(false)
const ledgerLoading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')

type AdminMode = 'visual' | 'manage'

const adminMode = ref<AdminMode>('visual')

const users = ref<AdminUser[]>([])
const selectedUser = ref<AdminUser | null>(null)
const transactions = ref<AdminTransaction[]>([])
const ledgerTransactions = ref<AdminLedgerEntry[]>([])
const adminImages = ref<AdminImageItem[]>([])
const imageAttempts = ref<AdminImageAttemptItem[]>([])
const imageAttemptOverview = ref<AdminImageAttemptOverview | null>(null)
const codes = ref<AdminCode[]>([])
const createdCodes = ref<AdminCode[]>([])
const overview = ref<AdminOverview | null>(null)
const systemStatus = ref<AdminSystemStatus | null>(null)
const appSettings = ref<AdminAppSettings | null>(null)
const providerSettings = ref<AdminProviderSettingsState | null>(null)
const adminUserRules = ref<AdminUserRule[]>([])
const adminAccess = ref<AdminAccessSummary | null>(null)
const currentAdminRole = ref<AdminRole>('operator')
const announcements = ref<AdminAnnouncement[]>([])
const selectedCode = ref<AdminCode | null>(null)
const codeRedemptions = ref<AdminCodeRedemption[]>([])

const userQuery = ref('')
const ledgerReason = ref('')
const ledgerHours = ref('168')
const ledgerUserId = ref('')
const imageVisibilityFilter = ref('')
const imageFundingFilter = ref('')
const imageUserFilter = ref('')
const imageQuery = ref('')
const imagesLoading = ref(false)
const imageBulkLoading = ref(false)
const imageActionId = ref<string | null>(null)
const selectedImageIds = ref<string[]>([])
const attemptStatusFilter = ref('')
const attemptUserFilter = ref('')
const attemptErrorTypeFilter = ref('')
const attemptHttpStatusFilter = ref('')
const attemptHoursFilter = ref('24')
const attemptsLoading = ref(false)
const storageOverview = ref<AdminImageStorageOverview | null>(null)
const storageOverviewLoading = ref(false)
const announcementsLoading = ref(false)
const announcementActionId = ref<string | null>(null)
const codeRedemptionsLoading = ref(false)
const adminRuleActionId = ref<string | null>(null)
const providerActionId = ref<string | null>(null)
const adjustAmount = ref(10)
const adjustNote = ref('')

const settingsForm = ref<AdminAppSettings>({
  imageCreditCostPerImage: 1,
  imageAnalyticsEnabled: false,
  imageResponsesModel: 'gpt-image-2',
  imageResponsesImageModel: 'gpt-image-2',
  imageEventsEnabled: false,
  canvasContextEnabled: false,
  freeGenerationEnabled: true,
  guestGenerationEnabled: true,
  availableImageModels: [],
})

const providerForm = ref({
  id: '',
  kind: 'image' as 'chat' | 'image',
  name: '',
  baseUrl: '',
  apiKey: '',
  clearApiKey: false,
  enabled: true,
  priority: 100,
  defaultModel: '',
  imageModel: 'gpt-image-2',
  editModel: 'gpt-image-2',
  timeoutMs: 360000,
  retryCount: 3,
  supportsWebpReferences: true,
  notes: '',
})

const adminUserForm = ref({
  userId: '',
  email: '',
  note: '',
})

const codeForm = ref({
  prefix: 'RECHO',
  credits: 100,
  count: 10,
  maxRedemptions: 1,
  days: 30,
  note: '',
})

const announcementForm = ref({
  title: '',
  body: '',
})

const settingsPricePerImage = computed(() => {
  const cost = normalizeCreditBalance(settingsForm.value.imageCreditCostPerImage)
  return cost !== null ? Math.max(0.01, cost) : 1
})

const settingsPricePreview = computed(() => [
  { label: '1 张', value: settingsPricePerImage.value },
  { label: '4 张', value: settingsPricePerImage.value * 4 },
  { label: '8 张', value: settingsPricePerImage.value * 8 },
])

const providerRows = computed(() => providerSettings.value?.providers || [])
const imageProviderRows = computed(() => providerRows.value.filter(provider => provider.kind === 'image'))
const chatProviderRows = computed(() => providerRows.value.filter(provider => provider.kind === 'chat'))
const editingProvider = computed(() => providerForm.value.id ? providerRows.value.find(provider => provider.id === providerForm.value.id) || null : null)

const imageCostConfidenceLabel = computed(() => {
  const confidence = overview.value?.imageCost?.confidence || 'none'
  if (confidence === 'high') return t('overview.confidenceHigh')
  if (confidence === 'medium') return t('overview.confidenceMedium')
  if (confidence === 'low') return t('overview.confidenceLow')
  return t('overview.confidenceNone')
})

const selectedUserTitle = computed(() => {
  if (!selectedUser.value) return t('credits.noUserSelected')
  return selectedUser.value.email || shortId(selectedUser.value.userId)
})

const overviewCodeHealth = computed(() => {
  if (!overview.value) return '0 / 0'
  return `${overview.value.codes.active} / ${overview.value.codes.total}`
})

const overviewNetChange = computed(() => {
  const recent = overview.value?.transactions.last7Days
  if (!recent) return 0
  return recent.redeemedCredits + recent.refundedCredits + recent.adminAdjustedCredits - recent.spentCredits
})

const overviewGeneratedAt = computed(() => {
  if (!overview.value) return t('overview.waiting')
  return `${t('overview.updatedAt')} ${dateTime(overview.value.generatedAt)}`
})

const systemGeneratedAt = computed(() => {
  if (!systemStatus.value) return t('system.waiting')
  return `${t('system.checkedAt')} ${dateTime(systemStatus.value.generatedAt)}`
})

const systemStatusLabel = computed(() => {
  if (!systemStatus.value) return t('system.statusPending')
  if (systemStatus.value.status === 'ok') return t('system.statusOk')
  if (systemStatus.value.status === 'warning') return t('system.statusWarning')
  return t('system.statusError')
})

const adminRuleTotal = computed(() => adminAccess.value
  ? adminAccess.value.databaseCount + adminAccess.value.envUserIdCount + adminAccess.value.envEmailCount
  : adminUserRules.value.length)

const canManageAdminUsers = computed(() => currentAdminRole.value === 'senior')

const createdCsv = computed(() => {
  const rows = [
    ['code', 'credits', 'max_redemptions', 'expires_at', 'note', 'database_id'],
    ...createdCodes.value.map(code => [
      code.code || '',
      String(code.credits),
      String(code.maxRedemptions),
      code.expiresAt || '',
      code.note || '',
      code.id,
    ]),
  ]
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
})

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function codeStatus(code: AdminCode) {
  if (code.disabledAt) return t('credits.codeStatus.disabled')
  if (code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now()) return t('credits.codeStatus.expired')
  if (code.redeemedCount >= code.maxRedemptions) return t('credits.codeStatus.exhausted')
  return t('credits.codeStatus.available')
}

function transactionReason(reason: string) {
  const key = `credits.transactionReason.${reason}` as const
  const translated = t(key)
  if (translated !== key) return translated
  return reason
}

function creditAmount(value: unknown) {
  return formatCreditAmount(value)
}

function signedCreditAmount(value: unknown) {
  return formatSignedCreditAmount(value)
}

function transactionNote(tx: AdminTransaction) {
  const note = tx.metadata?.note
  return typeof note === 'string' && note.trim() ? note : '-'
}

function ledgerDetails(tx: AdminLedgerEntry) {
  const parts = [
    tx.details.count !== null ? `${tx.details.count} 张` : '',
    tx.details.creditCostPerImage !== null ? `单图 ${creditAmount(tx.details.creditCostPerImage)} 额度` : '',
    tx.details.creditCost !== null ? `合计 ${creditAmount(tx.details.creditCost)} 额度` : '',
    tx.details.quality ? `质量 ${tx.details.quality}` : '',
    tx.details.resolution ? `分辨率 ${tx.details.resolution}` : '',
    tx.details.size ? `尺寸 ${tx.details.size}` : '',
    tx.details.aspectRatio ? `比例 ${tx.details.aspectRatio}` : '',
    tx.details.referenceCount !== null && tx.details.referenceCount > 0 ? `参考图 ${tx.details.referenceCount}` : '',
    tx.details.refundReason ? `退款原因 ${tx.details.refundReason}` : '',
    tx.generationId ? `生成 ${shortId(tx.generationId)}` : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '-'
}

function syncSettingsForm(settings: AdminAppSettings) {
  appSettings.value = settings
  settingsForm.value = { ...settings }
  settingsLoaded.value = true
}

function resetProviderForm(kind: 'chat' | 'image' = 'image') {
  providerForm.value = {
    id: '',
    kind,
    name: '',
    baseUrl: '',
    apiKey: '',
    clearApiKey: false,
    enabled: true,
    priority: 100,
    defaultModel: kind === 'chat' ? 'gpt-4o-mini' : '',
    imageModel: kind === 'image' ? 'gpt-image-2' : '',
    editModel: kind === 'image' ? 'gpt-image-2' : '',
    timeoutMs: kind === 'image' ? 360000 : 60000,
    retryCount: 3,
    supportsWebpReferences: kind === 'image',
    notes: '',
  }
}

function editProvider(provider: AdminProviderSetting) {
  providerForm.value = {
    id: provider.source === 'database' ? provider.id : '',
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: '',
    clearApiKey: false,
    enabled: provider.enabled,
    priority: provider.priority,
    defaultModel: provider.defaultModel || '',
    imageModel: provider.imageModel || '',
    editModel: provider.editModel || '',
    timeoutMs: provider.timeoutMs,
    retryCount: provider.retryCount,
    supportsWebpReferences: provider.supportsWebpReferences,
    notes: provider.notes || '',
  }
}

function providerPayload() {
  return {
    kind: providerForm.value.kind,
    name: providerForm.value.name,
    baseUrl: providerForm.value.baseUrl,
    apiKey: providerForm.value.apiKey,
    clearApiKey: providerForm.value.clearApiKey,
    enabled: providerForm.value.enabled,
    priority: providerForm.value.priority,
    defaultModel: providerForm.value.defaultModel,
    imageModel: providerForm.value.imageModel,
    editModel: providerForm.value.editModel,
    timeoutMs: providerForm.value.timeoutMs,
    retryCount: providerForm.value.retryCount,
    supportsWebpReferences: providerForm.value.supportsWebpReferences,
    notes: providerForm.value.notes,
  }
}

function providerStatusLabel(provider: AdminProviderSetting) {
  if (provider.enabled && provider.apiKeyConfigured) return '已启用'
  if (provider.enabled && !provider.apiKeyConfigured) return '缺少 Key'
  return '已停用'
}

function adminRuleIdentity(rule: AdminUserRule) {
  const userId = rule.userId ? `id: ${shortId(rule.userId)}` : ''
  return [rule.email, userId].filter(Boolean).join(' / ') || '-'
}

function adminRuleSource(rule: AdminUserRule) {
  return rule.source === 'env' ? t('settings.sourceEnv') : t('settings.sourceDb')
}

function adminRuleRoleLabel(rule: AdminUserRule) {
  return rule.source === 'env' || rule.role === 'senior' ? t('settings.seniorAdmin') : t('settings.operator')
}

function announcementStatusLabel(status: AdminAnnouncement['status']) {
  if (status === 'published') return t('announcements.statusPublished')
  if (status === 'archived') return t('announcements.statusArchived')
  return t('announcements.statusDraft')
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthAccessToken()
  if (!token) throw new Error('请先登录。')

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : '请求失败')
  }
  return data as T
}

function setError(error: unknown, fallback = '后台操作失败，请稍后重试。') {
  errorMessage.value = publicClientErrorMessage(error, fallback)
}

async function checkAdmin() {
  errorMessage.value = ''
  adminChecked.value = false
  try {
    const data = await apiJson<{ admin: boolean; currentAdminRole?: AdminRole | null }>('/api/admin/credits/me')
    currentAdminRole.value = data.currentAdminRole || 'operator'
    isAdmin.value = !!data.admin
  } catch (error) {
    isAdmin.value = false
    setError(error, '当前账号没有后台权限。')
  } finally {
    adminChecked.value = true
  }
}

async function refreshUsers() {
  loading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams()
    query.set('limit', '50')
    if (userQuery.value.trim()) query.set('query', userQuery.value.trim())
    const data = await apiJson<{ users: AdminUser[] }>(`/api/admin/credits/users?${query.toString()}`)
    users.value = data.users
    if (!selectedUser.value && data.users[0]) {
      await selectUser(data.users[0])
    } else if (selectedUser.value) {
      const updated = data.users.find(item => item.userId === selectedUser.value?.userId)
      if (updated) selectedUser.value = updated
    }
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

async function refreshCodes() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ codes: AdminCode[] }>('/api/admin/credits/codes?limit=50')
    codes.value = data.codes
    if (selectedCode.value) {
      selectedCode.value = data.codes.find(code => code.id === selectedCode.value?.id) || null
      if (!selectedCode.value) codeRedemptions.value = []
    }
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

async function refreshOverview() {
  overviewLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ overview: AdminOverview }>('/api/admin/credits/overview')
    overview.value = data.overview
  } catch (error) {
    setError(error)
  } finally {
    overviewLoading.value = false
  }
}

async function refreshSystem() {
  systemLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ system: AdminSystemStatus }>('/api/admin/system')
    systemStatus.value = data.system
  } catch (error) {
    setError(error)
  } finally {
    systemLoading.value = false
  }
}

async function refreshSettings() {
  settingsLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{
      settings: AdminAppSettings
      adminUsers: AdminUserRule[]
      adminAccess: AdminAccessSummary
      providerSettings: AdminProviderSettingsState
      currentAdminRole?: AdminRole | null
    }>('/api/admin/settings')
    syncSettingsForm(data.settings)
    providerSettings.value = data.providerSettings
    adminUserRules.value = data.adminUsers
    adminAccess.value = data.adminAccess
    currentAdminRole.value = data.currentAdminRole || 'operator'
  } catch (error) {
    setError(error)
  } finally {
    settingsLoading.value = false
  }
}

async function saveSettings() {
  if (!settingsLoaded.value) return
  settingsSaving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{ settings: AdminAppSettings }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        imageCreditCostPerImage: settingsPricePerImage.value,
        imageAnalyticsEnabled: Boolean(settingsForm.value.imageAnalyticsEnabled),
        imageResponsesModel: settingsForm.value.imageResponsesModel,
        imageResponsesImageModel: settingsForm.value.imageResponsesImageModel,
        imageEventsEnabled: Boolean(settingsForm.value.imageEventsEnabled),
        canvasContextEnabled: Boolean(settingsForm.value.canvasContextEnabled),
        freeGenerationEnabled: Boolean(settingsForm.value.freeGenerationEnabled),
        guestGenerationEnabled: Boolean(settingsForm.value.guestGenerationEnabled),
        availableImageModels: settingsForm.value.availableImageModels,
      }),
    })
    syncSettingsForm(data.settings)
    noticeMessage.value = `生图价格已保存：每张 ${data.settings.imageCreditCostPerImage} 额度`
    await Promise.all([refreshOverview(), refreshSystem()])
  } catch (error) {
    setError(error)
  } finally {
    settingsSaving.value = false
  }
}

async function saveProvider() {
  if (!canManageAdminUsers.value) {
    errorMessage.value = t('settings.onlySeniorCanManage')
    return
  }
  providerActionId.value = providerForm.value.id || 'new'
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const isUpdate = Boolean(providerForm.value.id)
    const data = await apiJson<{
      provider: AdminProviderSetting
      providerSettings: AdminProviderSettingsState
    }>(
      isUpdate
        ? `/api/admin/settings/providers/${encodeURIComponent(providerForm.value.id)}`
        : '/api/admin/settings/providers',
      {
        method: isUpdate ? 'PATCH' : 'POST',
        body: JSON.stringify(providerPayload()),
      },
    )
    providerSettings.value = data.providerSettings
    resetProviderForm(providerForm.value.kind)
    noticeMessage.value = `Provider 已保存：${data.provider.name}`
    await refreshSystem()
  } catch (error) {
    setError(error, 'Provider 配置保存失败，请稍后重试。')
  } finally {
    providerActionId.value = null
  }
}

async function refreshAnnouncements() {
  announcementsLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ announcements: AdminAnnouncement[] }>('/api/admin/announcements')
    announcements.value = data.announcements
  } catch (error) {
    setError(error)
  } finally {
    announcementsLoading.value = false
  }
}

async function refreshLedger() {
  ledgerLoading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams()
    query.set('limit', '50')
    if (ledgerReason.value) query.set('reason', ledgerReason.value)
    if (ledgerHours.value) query.set('hours', ledgerHours.value)
    if (ledgerUserId.value.trim()) query.set('userId', ledgerUserId.value.trim())
    const data = await apiJson<{ transactions: AdminLedgerEntry[] }>(`/api/admin/credits/transactions?${query.toString()}`)
    ledgerTransactions.value = data.transactions
  } catch (error) {
    setError(error)
  } finally {
    ledgerLoading.value = false
  }
}

async function refreshImages() {
  imagesLoading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams()
    query.set('limit', '24')
    if (imageVisibilityFilter.value) query.set('visibility', imageVisibilityFilter.value)
    if (imageFundingFilter.value) query.set('fundingSource', imageFundingFilter.value)
    if (imageUserFilter.value.trim()) query.set('userId', imageUserFilter.value.trim())
    if (imageQuery.value.trim()) query.set('query', imageQuery.value.trim())
    const data = await apiJson<{ images: AdminImageItem[] }>(`/api/admin/images?${query.toString()}`)
    adminImages.value = data.images
    const visibleIds = new Set(data.images.map(image => image.id))
    selectedImageIds.value = selectedImageIds.value.filter(id => visibleIds.has(id))
  } catch (error) {
    setError(error)
  } finally {
    imagesLoading.value = false
  }
}

async function refreshStorageOverview() {
  storageOverviewLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ overview: AdminImageStorageOverview }>('/api/admin/images/storage-overview')
    storageOverview.value = data.overview
  } catch (error) {
    setError(error)
  } finally {
    storageOverviewLoading.value = false
  }
}

function formatByteSize(bytes: number) {
  if (!bytes || bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`
}

function storageLocationLabel(location: AdminImageStorageStat['location']) {
  if (location === 'cos') return t('images.cos')
  if (location === 'supabase') return t('images.supabase')
  if (location === 'data') return t('images.data')
  return t('images.unknown')
}

async function refreshAttempts() {
  attemptsLoading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams()
    query.set('limit', '40')
    query.set('hours', attemptHoursFilter.value || '24')
    if (attemptStatusFilter.value) query.set('status', attemptStatusFilter.value)
    if (attemptUserFilter.value.trim()) query.set('userId', attemptUserFilter.value.trim())
    if (attemptErrorTypeFilter.value.trim()) query.set('errorType', attemptErrorTypeFilter.value.trim())
    if (attemptHttpStatusFilter.value.trim()) query.set('httpStatus', attemptHttpStatusFilter.value.trim())
    const data = await apiJson<{
      overview: AdminImageAttemptOverview
      attempts: AdminImageAttemptItem[]
    }>(`/api/admin/image-attempts?${query.toString()}`)
    imageAttemptOverview.value = data.overview
    imageAttempts.value = data.attempts
  } catch (error) {
    setError(error)
  } finally {
    attemptsLoading.value = false
  }
}

async function selectUser(target: AdminUser) {
  selectedUser.value = target
  errorMessage.value = ''
  try {
    const data = await apiJson<{ user: AdminUser; transactions: AdminTransaction[] }>(`/api/admin/credits/users/${encodeURIComponent(target.userId)}?limit=30`)
    selectedUser.value = data.user
    transactions.value = data.transactions
  } catch (error) {
    setError(error)
  }
}

function applyImageUpdates(updatedImages: AdminImageItem[]) {
  const updatedById = new Map(updatedImages.map(image => [image.id, image]))
  const nextImages = adminImages.value.map(item => updatedById.get(item.id) || item)
  adminImages.value = imageVisibilityFilter.value
    ? nextImages.filter(item => item.visibility === imageVisibilityFilter.value)
    : nextImages
  const visibleIds = new Set(adminImages.value.map(image => image.id))
  selectedImageIds.value = selectedImageIds.value.filter(id => visibleIds.has(id))
}

async function setImageVisibility(image: AdminImageItem, visibility: AdminImageItem['visibility']) {
  if (adminMode.value !== 'manage') return
  if (visibility === 'public' && image.fundingSource === 'credit') return
  if (visibility === 'private' && !window.confirm(t('images.confirmHide'))) return

  imageActionId.value = image.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{ image: AdminImageItem }>(
      `/api/admin/images/${encodeURIComponent(image.id)}/visibility`,
      {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      },
    )
    applyImageUpdates([data.image])
    noticeMessage.value = visibility === 'private' ? t('images.hidden') : t('images.restored')
  } catch (error) {
    setError(error)
  } finally {
    imageActionId.value = null
  }
}

async function bulkArchiveImages() {
  if (adminMode.value !== 'manage') return
  if (!selectedImageIds.value.length) return
  if (!window.confirm(t('images.confirmArchive', { count: selectedImageIds.value.length }))) return

  imageBulkLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{ images: AdminImageItem[] }>('/api/admin/images/bulk/archive', {
      method: 'POST',
      body: JSON.stringify({ ids: selectedImageIds.value }),
    })
    applyImageUpdates(data.images)
    noticeMessage.value = `${t('images.archived')} ${data.images.length}`
  } catch (error) {
    setError(error)
  } finally {
    imageBulkLoading.value = false
  }
}

async function bulkDeleteImages() {
  if (adminMode.value !== 'manage') return
  if (!selectedImageIds.value.length) return
  if (!window.confirm(t('images.confirmDelete', { count: selectedImageIds.value.length }))) return

  imageBulkLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  const deletingIds = new Set(selectedImageIds.value)
  try {
    const data = await apiJson<{ deletedIds: string[]; deletedCount: number }>('/api/admin/images/bulk/delete', {
      method: 'POST',
      body: JSON.stringify({ ids: selectedImageIds.value }),
    })
    const deletedIds = new Set(data.deletedIds.length ? data.deletedIds : Array.from(deletingIds))
    adminImages.value = adminImages.value.filter(image => !deletedIds.has(image.id))
    selectedImageIds.value = []
    noticeMessage.value = `${t('images.deleted')} ${data.deletedCount}`
  } catch (error) {
    setError(error)
  } finally {
    imageBulkLoading.value = false
  }
}

async function createAnnouncement() {
  if (!announcementForm.value.title.trim() || !announcementForm.value.body.trim()) {
    errorMessage.value = t('feedback.enterTitle')
    return
  }

  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{ announcement: AdminAnnouncement }>('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({
        title: announcementForm.value.title,
        body: announcementForm.value.body,
        status: 'published',
      }),
    })
    announcements.value = [data.announcement, ...announcements.value.filter(item => item.id !== data.announcement.id)]
    announcementForm.value = { title: '', body: '' }
    noticeMessage.value = t('announcements.published')
    await refreshSystem()
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function setAnnouncementStatus(announcement: AdminAnnouncement, status: AdminAnnouncement['status']) {
  announcementActionId.value = announcement.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{ announcement: AdminAnnouncement }>(`/api/admin/announcements/${encodeURIComponent(announcement.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    announcements.value = announcements.value.map(item => item.id === data.announcement.id ? data.announcement : item)
    noticeMessage.value = status === 'published' ? t('announcements.published') : t('announcements.archived')
  } catch (error) {
    setError(error)
  } finally {
    announcementActionId.value = null
  }
}

async function submitAdjustment() {
  if (!selectedUser.value || !adjustAmount.value) return
  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{ user: AdminUser; transactions: AdminTransaction[] }>(
      `/api/admin/credits/users/${encodeURIComponent(selectedUser.value.userId)}/adjust`,
      {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(adjustAmount.value),
          note: adjustNote.value,
        }),
      },
    )
    selectedUser.value = data.user
    transactions.value = data.transactions
    users.value = users.value.map(item => item.userId === data.user.userId ? data.user : item)
    adjustNote.value = ''
    noticeMessage.value = t('feedback.creditsAdjusted')
    await Promise.all([refreshOverview(), refreshLedger()])
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function createCodes() {
  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  createdCodes.value = []
  try {
    const data = await apiJson<{ codes: AdminCode[] }>('/api/admin/credits/codes', {
      method: 'POST',
      body: JSON.stringify({
        prefix: codeForm.value.prefix,
        credits: Number(codeForm.value.credits),
        count: Number(codeForm.value.count),
        maxRedemptions: Number(codeForm.value.maxRedemptions),
        days: Number(codeForm.value.days),
        note: codeForm.value.note,
      }),
    })
    createdCodes.value = data.codes
    noticeMessage.value = t('feedback.codesGenerated', { count: data.codes.length })
    await Promise.all([refreshCodes(), refreshOverview()])
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function viewCodeRedemptions(code: AdminCode) {
  selectedCode.value = code
  codeRedemptions.value = []
  codeRedemptionsLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ redemptions: AdminCodeRedemption[] }>(
      `/api/admin/credits/codes/${encodeURIComponent(code.id)}/redemptions?limit=50`,
    )
    codeRedemptions.value = data.redemptions
  } catch (error) {
    setError(error)
  } finally {
    codeRedemptionsLoading.value = false
  }
}

async function setCodeDisabled(code: AdminCode, disabled: boolean) {
  if (disabled && !window.confirm(t('feedback.confirmDisableCode'))) return
  actionLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ code: AdminCode }>(`/api/admin/credits/codes/${encodeURIComponent(code.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    })
    codes.value = codes.value.map(item => item.id === data.code.id ? data.code : item)
    if (selectedCode.value?.id === data.code.id) selectedCode.value = data.code
    noticeMessage.value = disabled ? t('feedback.codeDisabled') : t('feedback.codeRestored')
    await refreshOverview()
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function createAdminRule() {
  if (!canManageAdminUsers.value) {
    errorMessage.value = t('settings.onlySeniorCanManage')
    return
  }
  if (!adminUserForm.value.userId.trim() && !adminUserForm.value.email.trim()) {
    errorMessage.value = t('feedback.enterUserIdOrEmail')
    return
  }

  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{
      adminUsers: AdminUserRule[]
      adminAccess: AdminAccessSummary
    }>('/api/admin/settings/admin-users', {
      method: 'POST',
      body: JSON.stringify({
        userId: adminUserForm.value.userId.trim(),
        email: adminUserForm.value.email.trim(),
        note: adminUserForm.value.note,
      }),
    })
    adminUserRules.value = data.adminUsers
    adminAccess.value = data.adminAccess
    adminUserForm.value = { userId: '', email: '', note: '' }
    noticeMessage.value = t('settings.ruleAdded')
    await refreshSystem()
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function setAdminRuleEnabled(rule: AdminUserRule, enabled: boolean) {
  if (rule.source !== 'database') return
  if (!canManageAdminUsers.value) {
    errorMessage.value = t('settings.onlySeniorCanManage')
    return
  }
  if (!enabled && !window.confirm(t('settings.confirmDisableRule'))) return

  adminRuleActionId.value = rule.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{
      adminUsers: AdminUserRule[]
      adminAccess: AdminAccessSummary
    }>(`/api/admin/settings/admin-users/${encodeURIComponent(rule.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    })
    adminUserRules.value = data.adminUsers
    adminAccess.value = data.adminAccess
    noticeMessage.value = enabled ? t('settings.ruleEnabled') : t('settings.ruleDisabled')
    await refreshSystem()
  } catch (error) {
    setError(error)
  } finally {
    adminRuleActionId.value = null
  }
}

async function copyCreatedCsv() {
  if (!createdCodes.value.length) return
  try {
    await navigator.clipboard.writeText(createdCsv.value)
    noticeMessage.value = t('feedback.csvCopied')
  } catch (error) {
    setError(error, t('feedback.copyFailed'))
  }
}

function downloadCreatedCsv() {
  if (!createdCodes.value.length) return
  const blob = new Blob([`${createdCsv.value}\n`], { type: 'text/csv;charset=utf-8' })
  const downloadUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = `recho-credit-codes-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  link.click()
  URL.revokeObjectURL(downloadUrl)
}

onMounted(async () => {
  await initAuth()
  await checkAdmin()
  if (isAdmin.value) {
    await Promise.all([
      refreshOverview(),
      refreshSystem(),
      refreshSettings(),
      refreshLedger(),
      refreshImages(),
      refreshStorageOverview(),
      refreshAttempts(),
      refreshAnnouncements(),
      refreshUsers(),
      refreshCodes(),
    ])
  }
})
</script>

<template>
  <div class="admin-root" :class="{ dark: isDark }">
    <!-- Sidebar -->
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header">
        <div class="brand">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span v-show="!sidebarCollapsed" class="brand-text">Recho Admin</span>
        </div>
        <button class="sidebar-toggle" @click="toggleSidebar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
            <path v-if="!sidebarCollapsed" d="M15 19l-7-7 7-7" />
            <path v-else d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-item"
          :class="{ active: activeView === item.id }"
          @click="activeView = item.id"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
            <path :d="item.icon" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-show="!sidebarCollapsed" class="nav-label">{{ t(item.labelKey) }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button class="sidebar-action" @click="toggleLocale">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
            <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <span v-show="!sidebarCollapsed">{{ locale === 'zh' ? '中文' : 'EN' }}</span>
        </button>
        <button class="sidebar-action" @click="toggleTheme">
          <svg v-if="!isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
            <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <span v-show="!sidebarCollapsed">{{ isDark ? t('common.lightMode') : t('common.darkMode') }}</span>
        </button>
        <div class="sidebar-links" v-show="!sidebarCollapsed">
          <RouterLink to="/image" class="ext-link">{{ t('nav.canvas') }}</RouterLink>
          <RouterLink to="/works" class="ext-link">{{ t('nav.works') }}</RouterLink>
        </div>
        <div v-if="user && !sidebarCollapsed" class="user-badge">
          <div class="user-avatar">{{ (userEmail || 'A').charAt(0).toUpperCase() }}</div>
          <div class="user-detail">
            <span class="user-email">{{ userEmail || 'Admin' }}</span>
            <span class="user-role">{{ currentAdminRole === 'senior' ? t('settings.seniorAdmin') : t('settings.operator') }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Area -->
    <div class="main-area">
      <!-- Top Bar -->
      <header class="topbar">
        <div class="topbar-left">
          <h1 class="page-title">{{ t(`nav.${activeView}`) }}</h1>
          <div class="mode-switch" role="group">
            <button :class="{ active: adminMode === 'visual' }" @click="adminMode = 'visual'">{{ t('mode.visual') }}</button>
            <button :class="{ active: adminMode === 'manage' }" @click="adminMode = 'manage'">{{ t('mode.manage') }}</button>
          </div>
        </div>
      </header>

      <!-- Auth States -->
      <div v-if="!isAuthReady || !adminChecked" class="auth-state">
        <span class="spinner" />
        <strong>{{ t('auth.checking') }}</strong>
      </div>

      <div v-else-if="!user" class="auth-state">
        <strong>{{ t('auth.loginRequired') }}</strong>
        <RouterLink to="/image" class="btn-secondary">{{ t('auth.loginLink') }}</RouterLink>
      </div>

      <div v-else-if="!isAdmin" class="auth-state">
        <strong>{{ errorMessage || t('auth.noAccess') }}</strong>
        <span class="text-muted">{{ userEmail }}</span>
      </div>

      <!-- Content -->
      <main v-else class="content">
        <!-- Feedback Messages -->
        <div class="feedback" aria-live="polite">
          <p v-if="errorMessage" class="feedback-msg error">{{ errorMessage }}</p>
          <p v-if="noticeMessage" class="feedback-msg success">{{ noticeMessage }}</p>
        </div>

        <!-- ===== OVERVIEW ===== -->
        <section v-if="activeView === 'overview'" class="view-section">
          <!-- KPI Grid -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">{{ t('overview.title') }}</h2>
                <span class="card-subtitle">{{ overviewGeneratedAt }}</span>
              </div>
              <button class="btn-secondary" :disabled="overviewLoading" @click="refreshOverview">{{ t('common.refresh') }}</button>
            </div>
            <div class="kpi-grid">
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.totalBalance') }}</span>
                <strong class="kpi-value">{{ creditAmount(overview?.users.totalBalance) }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.totalRedeemed') }}</span>
                <strong class="kpi-value">{{ creditAmount(overview?.users.totalRedeemed) }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.totalSpent') }}</span>
                <strong class="kpi-value">{{ creditAmount(overview?.users.totalSpent) }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.imageCostPerImage') }}</span>
                <strong class="kpi-value">{{ creditAmount(overview?.settings.imageCreditCostPerImage ?? 1) }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.availableCodes') }}</span>
                <strong class="kpi-value">{{ overviewCodeHealth }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.redeemedCodeCredits') }}</span>
                <strong class="kpi-value">{{ creditAmount(overview?.codes.totalRedeemedCredits) }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.weeklyTxns') }}</span>
                <strong class="kpi-value">{{ overview?.transactions.last7Days.totalCount ?? 0 }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.weeklySpend') }}</span>
                <strong class="kpi-value">{{ creditAmount(overview?.transactions.last7Days.spentCredits) }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.weeklyNet') }}</span>
                <strong class="kpi-value" :class="overviewNetChange >= 0 ? 'text-positive' : 'text-negative'">{{ signedCreditAmount(overviewNetChange) }}</strong>
              </div>
            </div>
          </div>

          <!-- Image Cost Panel -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">{{ t('overview.imageCost') }}</h2>
                <span class="card-subtitle">{{ t('overview.payAsYouGo') }} · {{ t('overview.confidence') }} {{ imageCostConfidenceLabel }}</span>
              </div>
              <span class="cost-big">¥{{ overview?.imageCost?.totalCostPerImage?.toFixed(4) ?? '0.0000' }}<small>{{ t('overview.imageCostUnit') }}</small></span>
            </div>
            <div class="kpi-grid cols-6">
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.cosStoragePerImage') }}</span>
                <strong class="kpi-value sm">¥{{ overview?.imageCost?.cosStorageCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.cosTrafficPerImage') }}</span>
                <strong class="kpi-value sm">¥{{ overview?.imageCost?.cosTrafficCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.supabaseStoragePerImage') }}</span>
                <strong class="kpi-value sm">¥{{ overview?.imageCost?.supabaseStorageCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.supabaseTrafficPerImage') }}</span>
                <strong class="kpi-value sm">¥{{ overview?.imageCost?.supabaseTrafficCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.estimatedMonthlyCost') }}</span>
                <strong class="kpi-value sm">¥{{ overview?.imageCost?.estimatedMonthlyCost?.toFixed(2) ?? '0.00' }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('overview.sampleCount') }}</span>
                <strong class="kpi-value sm">{{ overview?.imageCost?.cosImageCount ?? 0 }} COS / {{ overview?.imageCost?.supabaseImageCount ?? 0 }} SB</strong>
              </div>
            </div>
          </div>

          <!-- Ledger -->
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">{{ t('credits.ledger.title') }}</h2>
                <span class="card-subtitle">{{ ledgerTransactions.length }}</span>
              </div>
              <div class="filter-group">
                <select v-model="ledgerReason" :disabled="ledgerLoading" @change="refreshLedger">
                  <option value="">{{ t('credits.ledger.allTypes') }}</option>
                  <option value="redemption">{{ t('credits.transactionReason.redemption') }}</option>
                  <option value="image_generation">{{ t('credits.transactionReason.image_generation') }}</option>
                  <option value="refund">{{ t('credits.transactionReason.refund') }}</option>
                  <option value="admin_adjustment">{{ t('credits.transactionReason.admin_adjustment') }}</option>
                </select>
                <select v-model="ledgerHours" :disabled="ledgerLoading" @change="refreshLedger">
                  <option value="24">{{ t('credits.ledger.last24h') }}</option>
                  <option value="168">{{ t('credits.ledger.last7d') }}</option>
                  <option value="720">{{ t('credits.ledger.last30d') }}</option>
                  <option value="">{{ t('credits.ledger.allTime') }}</option>
                </select>
                <input v-model="ledgerUserId" type="search" :placeholder="t('credits.ledger.userIdFilter')" :disabled="ledgerLoading" @keyup.enter="refreshLedger" class="input-sm" />
                <button class="btn-secondary" :disabled="ledgerLoading" @click="refreshLedger">{{ t('common.refresh') }}</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('credits.table.time') }}</th>
                    <th>{{ t('credits.table.user') }}</th>
                    <th>{{ t('credits.table.type') }}</th>
                    <th>{{ t('credits.table.change') }}</th>
                    <th>{{ t('credits.table.balance') }}</th>
                    <th>{{ t('credits.table.details') }}</th>
                    <th>{{ t('credits.table.note') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tx in ledgerTransactions" :key="tx.id">
                    <td class="text-caption">{{ dateTime(tx.createdAt) }}</td>
                    <td>{{ tx.email || shortId(tx.userId) }}</td>
                    <td><span class="badge">{{ transactionReason(tx.reason) }}</span></td>
                    <td class="text-mono" :class="tx.amount >= 0 ? 'text-positive' : 'text-negative'">{{ signedCreditAmount(tx.amount) }}</td>
                    <td class="text-mono">{{ creditAmount(tx.balanceAfter) }}</td>
                    <td class="text-caption">{{ ledgerDetails(tx) }}</td>
                    <td class="text-caption">{{ tx.note || '-' }}</td>
                  </tr>
                  <tr v-if="!ledgerTransactions.length">
                    <td colspan="7" class="empty-cell">{{ t('common.noData') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== CREDITS ===== -->
        <section v-else-if="activeView === 'credits'" class="view-section">
          <div class="two-col">
            <!-- User List -->
            <div class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">{{ t('credits.users') }}</h2>
                  <span class="card-subtitle">{{ users.length }}</span>
                </div>
                <button class="btn-secondary" :disabled="loading" @click="refreshUsers">{{ t('common.refresh') }}</button>
              </div>
              <form class="search-row" @submit.prevent="refreshUsers">
                <input v-model.trim="userQuery" type="search" :placeholder="t('credits.searchUsers')" />
                <button class="btn-secondary" type="submit" :disabled="loading">{{ t('common.search') }}</button>
              </form>
              <div class="user-list">
                <button
                  v-for="item in users"
                  :key="item.userId"
                  class="user-row"
                  :class="{ active: selectedUser?.userId === item.userId }"
                  @click="selectUser(item)"
                >
                  <span>{{ item.email || shortId(item.userId) }}</span>
                  <strong class="text-mono">{{ creditAmount(item.balance) }}</strong>
                </button>
              </div>
            </div>

            <!-- User Detail -->
            <div class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">{{ t('credits.userDetail') }}</h2>
                  <span class="card-subtitle">{{ selectedUserTitle }}</span>
                </div>
              </div>

              <div v-if="selectedUser" class="kpi-grid cols-4">
                <div class="kpi-item">
                  <span class="kpi-label">{{ t('credits.balance') }}</span>
                  <strong class="kpi-value">{{ creditAmount(selectedUser.balance) }}</strong>
                </div>
                <div class="kpi-item">
                  <span class="kpi-label">{{ t('credits.totalRedeemed') }}</span>
                  <strong class="kpi-value">{{ creditAmount(selectedUser.totalRedeemed) }}</strong>
                </div>
                <div class="kpi-item">
                  <span class="kpi-label">{{ t('credits.totalSpent') }}</span>
                  <strong class="kpi-value">{{ creditAmount(selectedUser.totalSpent) }}</strong>
                </div>
                <div class="kpi-item">
                  <span class="kpi-label">{{ t('common.updatedAt') }}</span>
                  <strong class="kpi-value sm">{{ dateTime(selectedUser.updatedAt) }}</strong>
                </div>
              </div>

              <form class="inline-form" @submit.prevent="submitAdjustment">
                <input v-model.number="adjustAmount" type="number" step="1" :placeholder="t('credits.adjustPlaceholder')" class="input-sm" />
                <input v-model.trim="adjustNote" type="text" :placeholder="t('credits.adjustNotePlaceholder')" class="input-sm" />
                <button class="btn-primary" type="submit" :disabled="actionLoading || !selectedUser || !adjustAmount">{{ t('common.submit') }}</button>
              </form>

              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{{ t('credits.table.time') }}</th>
                      <th>{{ t('credits.table.type') }}</th>
                      <th>{{ t('credits.table.change') }}</th>
                      <th>{{ t('credits.table.balance') }}</th>
                      <th>{{ t('credits.table.note') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="tx in transactions" :key="tx.id">
                      <td class="text-caption">{{ dateTime(tx.created_at) }}</td>
                      <td><span class="badge">{{ transactionReason(tx.reason) }}</span></td>
                      <td class="text-mono" :class="tx.amount >= 0 ? 'text-positive' : 'text-negative'">{{ signedCreditAmount(tx.amount) }}</td>
                      <td class="text-mono">{{ creditAmount(tx.balance_after) }}</td>
                      <td class="text-caption">{{ transactionNote(tx) }}</td>
                    </tr>
                    <tr v-if="!transactions.length">
                      <td colspan="5" class="empty-cell">{{ t('common.noData') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Codes Section -->
          <div class="two-col">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">{{ t('credits.generateCodes') }}</h2>
                <span class="card-subtitle">{{ codeForm.count }} {{ t('credits.codeCount') }}</span>
              </div>
              <form class="form-grid cols-3" @submit.prevent="createCodes">
                <label class="form-field">
                  <span class="form-label">{{ t('credits.prefix') }}</span>
                  <input v-model.trim="codeForm.prefix" type="text" />
                </label>
                <label class="form-field">
                  <span class="form-label">{{ t('credits.creditsPerCode') }}</span>
                  <input v-model.number="codeForm.credits" type="number" min="1" step="1" />
                </label>
                <label class="form-field">
                  <span class="form-label">{{ t('credits.quantity') }}</span>
                  <input v-model.number="codeForm.count" type="number" min="1" max="100" step="1" />
                </label>
                <label class="form-field">
                  <span class="form-label">{{ t('credits.maxRedemptions') }}</span>
                  <input v-model.number="codeForm.maxRedemptions" type="number" min="1" step="1" />
                </label>
                <label class="form-field">
                  <span class="form-label">{{ t('credits.validDays') }}</span>
                  <input v-model.number="codeForm.days" type="number" min="1" step="1" />
                </label>
                <label class="form-field">
                  <span class="form-label">{{ t('common.note') }}</span>
                  <input v-model.trim="codeForm.note" type="text" />
                </label>
                <div class="form-actions">
                  <button class="btn-primary" type="submit" :disabled="actionLoading">{{ t('common.generate') }}</button>
                </div>
              </form>

              <div v-if="createdCodes.length" class="created-output">
                <div class="created-actions">
                  <strong>{{ t('credits.thisBatch') }}</strong>
                  <button class="btn-ghost" @click="copyCreatedCsv">{{ t('credits.copyCsv') }}</button>
                  <button class="btn-ghost" @click="downloadCreatedCsv">{{ t('credits.downloadCsv') }}</button>
                </div>
                <textarea :value="createdCsv" readonly rows="6" />
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">{{ t('credits.codes') }}</h2>
                  <span class="card-subtitle">{{ codes.length }}</span>
                </div>
                <button class="btn-secondary" :disabled="loading" @click="refreshCodes">{{ t('common.refresh') }}</button>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{{ t('credits.table.created') }}</th>
                      <th>{{ t('credits.table.credits') }}</th>
                      <th>{{ t('credits.table.usage') }}</th>
                      <th>{{ t('credits.table.status') }}</th>
                      <th>{{ t('credits.table.note') }}</th>
                      <th>{{ t('credits.table.actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="code in codes" :key="code.id">
                      <td class="text-caption">{{ dateTime(code.createdAt) }}</td>
                      <td class="text-mono">{{ code.credits }}</td>
                      <td class="text-mono">{{ code.redeemedCount }} / {{ code.maxRedemptions }}</td>
                      <td><span class="badge" :class="{ positive: codeStatus(code) === t('credits.codeStatus.available'), negative: codeStatus(code) !== t('credits.codeStatus.available') }">{{ codeStatus(code) }}</span></td>
                      <td class="text-caption">{{ code.note || '-' }}</td>
                      <td>
                        <div class="action-group">
                          <button class="btn-ghost" :disabled="codeRedemptionsLoading && selectedCode?.id === code.id" @click="viewCodeRedemptions(code)">{{ t('common.details') }}</button>
                          <button class="btn-ghost" :disabled="actionLoading" @click="setCodeDisabled(code, !code.disabledAt)">{{ code.disabledAt ? t('common.restore') : t('common.disable') }}</button>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="!codes.length">
                      <td colspan="6" class="empty-cell">{{ t('common.noData') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="selectedCode" class="created-output">
                <div class="created-actions">
                  <strong>{{ t('credits.codeRedemptions') }}</strong>
                  <span class="text-muted">{{ selectedCode.redeemedCount }} / {{ selectedCode.maxRedemptions }}</span>
                  <button class="btn-ghost" :disabled="codeRedemptionsLoading" @click="viewCodeRedemptions(selectedCode!)">{{ t('common.refresh') }}</button>
                </div>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{{ t('credits.table.time') }}</th>
                        <th>{{ t('credits.table.user') }}</th>
                        <th>{{ t('credits.table.credits') }}</th>
                        <th>{{ t('credits.table.balance') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in codeRedemptions" :key="r.id">
                        <td class="text-caption">{{ dateTime(r.redeemedAt) }}</td>
                        <td>{{ r.email || shortId(r.userId) }}</td>
                        <td class="text-mono">{{ r.credits }}</td>
                        <td class="text-mono">{{ r.balanceAfter ?? '-' }}</td>
                      </tr>
                      <tr v-if="!codeRedemptions.length">
                        <td colspan="4" class="empty-cell">{{ codeRedemptionsLoading ? t('common.loading') : t('common.noData') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ===== IMAGES ===== -->
        <section v-else-if="activeView === 'images'" class="view-section">
          <AdminImagesPanel
            v-model:selected-ids="selectedImageIds"
            v-model:visibility-filter="imageVisibilityFilter"
            v-model:funding-filter="imageFundingFilter"
            v-model:user-filter="imageUserFilter"
            v-model:query="imageQuery"
            :images="adminImages"
            :loading="imagesLoading"
            :bulk-loading="imageBulkLoading"
            :action-id="imageActionId"
            @refresh="refreshImages"
            @set-visibility="setImageVisibility"
            @bulk-archive="bulkArchiveImages"
            @bulk-delete="bulkDeleteImages"
          />

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">{{ t('images.storageOverview') }}</h2>
                <span class="card-subtitle">{{ storageOverview ? `${storageOverview.totalImages} ${t('images.imageCount')} / ${formatByteSize(storageOverview.totalBytes)}` : t('common.loading') }}</span>
              </div>
              <button class="btn-secondary" :disabled="storageOverviewLoading" @click="refreshStorageOverview">{{ t('common.refresh') }}</button>
            </div>
            <div v-if="storageOverviewLoading" class="empty-state">{{ t('images.statistics') }}</div>
            <div v-else-if="storageOverview" class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('images.storageLocation') }}</th>
                    <th>{{ t('images.imageCount') }}</th>
                    <th>{{ t('images.totalSize') }}</th>
                    <th>{{ t('images.avgSize') }}</th>
                    <th>{{ t('images.totalCredits') }}</th>
                    <th>{{ t('images.sizePercent') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="stat in storageOverview.byLocation" :key="stat.location">
                    <td>{{ storageLocationLabel(stat.location) }}</td>
                    <td class="text-mono">{{ stat.imageCount }}</td>
                    <td class="text-mono">{{ formatByteSize(stat.totalBytes) }}</td>
                    <td class="text-mono">{{ formatByteSize(stat.averageBytes) }}</td>
                    <td class="text-mono">{{ formatCreditAmount(stat.totalCreditCost) }}</td>
                    <td>{{ storageOverview.totalBytes > 0 ? `${(stat.totalBytes / storageOverview.totalBytes * 100).toFixed(1)}%` : '0%' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== MONITOR ===== -->
        <section v-else-if="activeView === 'monitor'" class="view-section">
          <AdminImageAttemptsPanel
            v-model:status-filter="attemptStatusFilter"
            v-model:user-filter="attemptUserFilter"
            v-model:error-type-filter="attemptErrorTypeFilter"
            v-model:http-status-filter="attemptHttpStatusFilter"
            v-model:hours-filter="attemptHoursFilter"
            :attempts="imageAttempts"
            :overview="imageAttemptOverview"
            :loading="attemptsLoading"
            @refresh="refreshAttempts"
          />
        </section>

        <!-- ===== SYSTEM ===== -->
        <section v-else-if="activeView === 'system'" class="view-section">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">{{ t('system.title') }}</h2>
                <span class="card-subtitle">{{ systemGeneratedAt }}</span>
              </div>
              <div class="header-actions">
                <span class="status-pill" :class="systemStatus?.status || 'warning'">{{ systemStatusLabel }}</span>
                <button class="btn-secondary" :disabled="systemLoading" @click="refreshSystem">{{ t('common.refresh') }}</button>
              </div>
            </div>
            <div class="kpi-grid cols-5">
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.supabaseBackend') }}</span>
                <strong class="kpi-value sm" :class="systemStatus ? (systemStatus.config.supabase.adminConfigured ? 'text-positive' : 'text-negative') : ''">
                  {{ systemStatus ? (systemStatus.config.supabase.adminConfigured ? t('system.ready') : t('system.notReady')) : '-' }}
                </strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.imageService') }}</span>
                <strong class="kpi-value sm" :class="systemStatus ? (systemStatus.config.imageGeneration.apiKeyConfigured ? 'text-positive' : 'text-negative') : ''">
                  {{ systemStatus ? (systemStatus.config.imageGeneration.apiKeyConfigured ? t('system.ready') : t('system.notReady')) : '-' }}
                </strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.adminRules') }}</span>
                <strong class="kpi-value sm">{{ systemStatus ? systemStatus.config.adminUsers.databaseCount + systemStatus.config.adminUsers.envUserIdCount + systemStatus.config.adminUsers.envEmailCount : '-' }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.imageMonitor') }}</span>
                <strong class="kpi-value sm">{{ systemStatus ? (systemStatus.config.imageGeneration.analyticsEnabled ? t('system.enabled') : t('system.disabled')) : '-' }}</strong>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.imageCostPerImage') }}</span>
                <strong class="kpi-value sm">{{ systemStatus?.config.imageGeneration.creditCostPerImage ?? 1 }}</strong>
              </div>
            </div>

            <!-- Storage Stats -->
            <div class="section-divider" />
            <h3 class="section-label">{{ t('system.storageStats') }}</h3>
            <div class="kpi-grid cols-4">
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.cosStorage') }}</span>
                <strong class="kpi-value sm">{{ overview?.imageCost?.cosImageCount ?? 0 }} 张</strong>
                <span class="kpi-sub">{{ t('system.avgPerImage') }} {{ (overview?.imageCost?.averageStoredMb ?? 0).toFixed(2) }} MB</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.supabaseStorage') }}</span>
                <strong class="kpi-value sm">{{ overview?.imageCost?.supabaseImageCount ?? 0 }} 张</strong>
                <span class="kpi-sub">{{ t('system.sampleDays') }} {{ overview?.imageCost?.sampleDays ?? 0 }} 天</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.estimatedMonthlyCost') }}</span>
                <strong class="kpi-value sm">¥{{ overview?.imageCost?.estimatedMonthlyCost?.toFixed(2) ?? '0.00' }}</strong>
                <span class="kpi-sub">{{ t('overview.confidence') }} {{ imageCostConfidenceLabel }}</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-label">{{ t('system.totalImages') }}</span>
                <strong class="kpi-value sm">{{ (overview?.imageCost?.cosImageCount ?? 0) + (overview?.imageCost?.supabaseImageCount ?? 0) }} 张</strong>
                <span class="kpi-sub">¥{{ overview?.imageCost?.totalCostPerImage?.toFixed(4) ?? '0.0000' }}/张</span>
              </div>
            </div>

            <!-- Warnings -->
            <div class="section-divider" />
            <h3 class="section-label">{{ t('system.warnings') }}</h3>
            <div class="warning-list">
              <span v-for="warning in systemStatus?.warnings || []" :key="warning" class="warning-item">{{ warning }}</span>
              <span v-if="systemStatus && !systemStatus.warnings.length" class="warning-item ok">{{ t('system.noWarnings') }}</span>
              <span v-else-if="!systemStatus" class="warning-item">{{ t('system.waitingCheck') }}</span>
            </div>

            <!-- System Table -->
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('system.table.module') }}</th>
                    <th>{{ t('system.table.status') }}</th>
                    <th>{{ t('system.table.records') }}</th>
                    <th>{{ t('system.table.message') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="table in systemStatus?.data.tables || []" :key="table.key">
                    <td>{{ table.label }}</td>
                    <td :class="table.status === 'ok' ? 'text-positive' : 'text-negative'">{{ tableStatusLabel(table.status) }}</td>
                    <td class="text-mono">{{ table.count ?? '-' }}</td>
                    <td class="text-caption">{{ table.message }}</td>
                  </tr>
                  <tr v-if="!(systemStatus?.data.tables || []).length">
                    <td colspan="4" class="empty-cell">{{ t('system.noResults') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== ANNOUNCEMENTS ===== -->
        <section v-else-if="activeView === 'announcements'" class="view-section">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">{{ t('announcements.title') }}</h2>
                <span class="card-subtitle">{{ announcements.length }}</span>
              </div>
              <button class="btn-secondary" :disabled="announcementsLoading" @click="refreshAnnouncements">{{ t('common.refresh') }}</button>
            </div>

            <form class="announcement-form" @submit.prevent="createAnnouncement">
              <label class="form-field">
                <span class="form-label">{{ t('announcements.titleLabel') }}</span>
                <input v-model.trim="announcementForm.title" type="text" maxlength="120" required />
              </label>
              <label class="form-field full">
                <span class="form-label">{{ t('announcements.bodyLabel') }}</span>
                <textarea v-model.trim="announcementForm.body" rows="4" maxlength="4000" required />
              </label>
              <button class="btn-primary" type="submit" :disabled="actionLoading">{{ t('announcements.publishBtn') }}</button>
            </form>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('announcements.table.updated') }}</th>
                    <th>{{ t('announcements.table.status') }}</th>
                    <th>{{ t('announcements.table.title') }}</th>
                    <th>{{ t('announcements.table.body') }}</th>
                    <th>{{ t('announcements.table.actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ann in announcements" :key="ann.id">
                    <td class="text-caption">{{ dateTime(ann.updatedAt) }}</td>
                    <td><span class="badge" :class="ann.status === 'published' ? 'positive' : 'muted'">{{ announcementStatusLabel(ann.status) }}</span></td>
                    <td class="text-title">{{ ann.title }}</td>
                    <td class="ann-body-cell">{{ ann.body }}</td>
                    <td>
                      <div class="action-group">
                        <button v-if="ann.status !== 'published'" class="btn-ghost" :disabled="announcementActionId === ann.id" @click="setAnnouncementStatus(ann, 'published')">{{ t('common.publish') }}</button>
                        <button v-if="ann.status !== 'archived'" class="btn-ghost" :disabled="announcementActionId === ann.id" @click="setAnnouncementStatus(ann, 'archived')">{{ t('common.archive') }}</button>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="!announcements.length">
                    <td colspan="5" class="empty-cell">{{ t('common.noData') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== SETTINGS ===== -->
        <section v-else-if="activeView === 'settings'" class="view-section">
          <div class="two-col">
            <!-- Runtime Config -->
            <div class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">{{ t('settings.runtimeConfig') }}</h2>
                  <span class="card-subtitle">{{ appSettings ? t('settings.loaded') : t('settings.waiting') }}</span>
                </div>
                <button class="btn-secondary" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</button>
              </div>

              <form class="settings-form" @submit.prevent="saveSettings">
                <div class="form-field">
                  <span class="form-label">{{ t('settings.imagePrice') }}</span>
                  <input v-model.number="settingsForm.imageCreditCostPerImage" type="number" min="0.01" step="0.01" required />
                  <div class="cost-preview">
                    <span v-for="item in settingsPricePreview" :key="item.label" class="cost-chip">{{ item.label }} {{ item.value }} 额度</span>
                  </div>
                </div>
                <label class="form-field">
                  <span class="form-label">{{ t('settings.responseModel') }}</span>
                  <input v-model.trim="settingsForm.imageResponsesModel" type="text" />
                </label>
                <label class="form-field">
                  <span class="form-label">{{ t('settings.imageModel') }}</span>
                  <input v-model.trim="settingsForm.imageResponsesImageModel" type="text" />
                </label>
                <label class="check-row">
                  <input v-model="settingsForm.imageAnalyticsEnabled" type="checkbox" />
                  <span>{{ t('settings.analytics') }}</span>
                </label>
                <label class="check-row">
                  <input v-model="settingsForm.imageEventsEnabled" type="checkbox" />
                  <span>{{ t('settings.frontendEvents') }}</span>
                </label>
                <label class="check-row">
                  <input v-model="settingsForm.canvasContextEnabled" type="checkbox" />
                  <span>{{ t('settings.canvasContext') }}</span>
                </label>
                <label class="check-row">
                  <input v-model="settingsForm.freeGenerationEnabled" type="checkbox" />
                  <span>{{ t('settings.freeGeneration') }}</span>
                </label>
                <label class="check-row">
                  <input v-model="settingsForm.guestGenerationEnabled" type="checkbox" />
                  <span>{{ t('settings.guestGeneration') }}</span>
                </label>
                <button class="btn-primary" type="submit" :disabled="settingsSaving || !settingsLoaded">{{ settingsSaving ? t('common.saving') : t('settings.saveConfig') }}</button>
              </form>
            </div>

            <!-- Provider Config -->
            <div class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">Provider / API Key</h2>
                  <span class="card-subtitle">{{ providerSettings?.tableAvailable ? '数据库配置' : '仅环境变量兜底' }}</span>
                </div>
                <button class="btn-secondary" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</button>
              </div>

              <form v-if="canManageAdminUsers" class="settings-form" @submit.prevent="saveProvider">
                <label class="form-field">
                  <span class="form-label">类型</span>
                  <select v-model="providerForm.kind" :disabled="Boolean(providerForm.id)" @change="resetProviderForm(providerForm.kind)">
                    <option value="image">Image</option>
                    <option value="chat">Chat</option>
                  </select>
                </label>
                <label class="form-field">
                  <span class="form-label">名称</span>
                  <input v-model.trim="providerForm.name" type="text" placeholder="lucen image / OpenAI" required />
                </label>
                <label class="form-field">
                  <span class="form-label">Base URL</span>
                  <input v-model.trim="providerForm.baseUrl" type="url" placeholder="https://example.com/v1" required />
                </label>
                <label class="form-field">
                  <span class="form-label">API Key</span>
                  <input v-model.trim="providerForm.apiKey" type="password" autocomplete="new-password" :placeholder="editingProvider?.apiKeyConfigured ? `保持当前 ${editingProvider.apiKeyPreview || ''}` : '输入 API key'" />
                </label>
                <label v-if="editingProvider?.apiKeyConfigured" class="check-row">
                  <input v-model="providerForm.clearApiKey" type="checkbox" />
                  <span>清空当前 API Key</span>
                </label>
                <div class="inline-form cols-3">
                  <label class="form-field">
                    <span class="form-label">优先级</span>
                    <input v-model.number="providerForm.priority" type="number" min="0" max="10000" />
                  </label>
                  <label class="form-field">
                    <span class="form-label">超时 ms</span>
                    <input v-model.number="providerForm.timeoutMs" type="number" min="1000" max="1200000" step="1000" />
                  </label>
                  <label class="form-field">
                    <span class="form-label">重试</span>
                    <input v-model.number="providerForm.retryCount" type="number" min="0" max="10" />
                  </label>
                </div>
                <label v-if="providerForm.kind === 'chat'" class="form-field">
                  <span class="form-label">默认 Chat 模型</span>
                  <input v-model.trim="providerForm.defaultModel" type="text" placeholder="gpt-4o-mini" />
                </label>
                <template v-else>
                  <label class="form-field">
                    <span class="form-label">生图模型</span>
                    <input v-model.trim="providerForm.imageModel" type="text" placeholder="gpt-image-2" />
                  </label>
                  <label class="form-field">
                    <span class="form-label">编辑模型</span>
                    <input v-model.trim="providerForm.editModel" type="text" placeholder="gpt-image-2" />
                  </label>
                  <label class="check-row">
                    <input v-model="providerForm.supportsWebpReferences" type="checkbox" />
                    <span>支持 WebP 参考图</span>
                  </label>
                </template>
                <label class="form-field">
                  <span class="form-label">备注</span>
                  <input v-model.trim="providerForm.notes" type="text" placeholder="用途、限额或供应商说明" />
                </label>
                <label class="check-row">
                  <input v-model="providerForm.enabled" type="checkbox" />
                  <span>启用</span>
                </label>
                <div class="action-group">
                  <button class="btn-primary" type="submit" :disabled="Boolean(providerActionId)">{{ providerActionId ? t('common.saving') : (providerForm.id ? '保存 Provider' : '新增 Provider') }}</button>
                  <button class="btn-ghost" type="button" @click="resetProviderForm(providerForm.kind)">重置</button>
                </div>
              </form>
              <p v-else class="hint-text">{{ t('settings.noManagePermission') }}</p>

              <div class="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>名称</th>
                      <th>模型</th>
                      <th>Key</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="provider in providerRows" :key="provider.id">
                      <td>{{ provider.kind }}</td>
                      <td>
                        <div class="text-title">{{ provider.name }}</div>
                        <div class="text-caption">{{ provider.baseUrl }}</div>
                      </td>
                      <td class="text-caption">{{ provider.kind === 'image' ? (provider.imageModel || '-') : (provider.defaultModel || '-') }}</td>
                      <td>{{ provider.apiKeyConfigured ? provider.apiKeyPreview || '已配置' : '未配置' }}</td>
                      <td>
                        <span class="badge" :class="provider.enabled && provider.apiKeyConfigured ? 'positive' : 'muted'">{{ providerStatusLabel(provider) }}</span>
                      </td>
                      <td>
                        <button class="btn-ghost" :disabled="provider.source !== 'database' || !canManageAdminUsers" @click="editProvider(provider)">编辑</button>
                      </td>
                    </tr>
                    <tr v-if="!providerRows.length">
                      <td colspan="6" class="empty-cell">暂无 Provider 配置</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="summary-grid mini">
                <div class="summary-tile">
                  <span>Image Providers</span>
                  <strong>{{ imageProviderRows.length }}</strong>
                </div>
                <div class="summary-tile">
                  <span>Chat Providers</span>
                  <strong>{{ chatProviderRows.length }}</strong>
                </div>
              </div>
            </div>

            <!-- Admin Users -->
            <div class="card">
              <div class="card-header">
                <div>
                  <h2 class="card-title">{{ t('settings.adminUsers') }}</h2>
                  <span class="card-subtitle">{{ adminRuleTotal }}</span>
                </div>
                <button class="btn-secondary" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</button>
              </div>

              <form v-if="canManageAdminUsers" class="inline-form cols-4" @submit.prevent="createAdminRule">
                <input v-model.trim="adminUserForm.userId" type="text" :placeholder="t('settings.adminUserId')" />
                <input v-model.trim="adminUserForm.email" type="email" :placeholder="t('settings.adminEmail')" />
                <input v-model.trim="adminUserForm.note" type="text" :placeholder="t('settings.adminNote')" />
                <button class="btn-primary" type="submit" :disabled="actionLoading">{{ t('common.add') }}</button>
              </form>
              <p v-else class="hint-text">{{ t('settings.noManagePermission') }}</p>

              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{{ t('settings.adminTable.account') }}</th>
                      <th>{{ t('settings.adminTable.level') }}</th>
                      <th>{{ t('settings.adminTable.source') }}</th>
                      <th>{{ t('settings.adminTable.status') }}</th>
                      <th>{{ t('settings.adminTable.updated') }}</th>
                      <th>{{ t('settings.adminTable.actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="rule in adminUserRules" :key="rule.id">
                      <td>{{ adminRuleIdentity(rule) }}</td>
                      <td><span class="badge">{{ adminRuleRoleLabel(rule) }}</span></td>
                      <td class="text-caption">{{ adminRuleSource(rule) }}</td>
                      <td :class="rule.enabled ? 'text-positive' : 'text-negative'">{{ rule.enabled ? t('settings.statusEnabled') : t('settings.statusDisabled') }}</td>
                      <td class="text-caption">{{ dateTime(rule.updatedAt) }}</td>
                      <td>
                        <button
                          class="btn-ghost"
                          :disabled="!canManageAdminUsers || rule.source !== 'database' || adminRuleActionId === rule.id"
                          @click="setAdminRuleEnabled(rule, !rule.enabled)"
                        >
                          {{ rule.enabled ? t('common.disable') : t('common.enable') }}
                        </button>
                      </td>
                    </tr>
                    <tr v-if="!adminUserRules.length">
                      <td colspan="6" class="empty-cell">{{ t('settings.noRules') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
/* =====================================================
   Recho AI Admin — Vercel-inspired Dashboard Design
   ===================================================== */

/* --- Seed Tokens (Light) --- */
.admin-root {
  --seed-bg: #ffffff;
  --seed-fg: #171717;
  --seed-primary: #0070f3;
  --seed-surface: #ffffff;
  --seed-surface-raised: #fafafa;
  --seed-surface-sunken: #f5f5f5;
  --seed-border: rgba(0, 0, 0, 0.08);
  --seed-border-strong: #ebebeb;
  --seed-muted: #666666;
  --seed-success: #16a34a;
  --seed-warning: #f5a623;
  --seed-danger: #ee0000;
  --seed-radius: 6px;
  --seed-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --seed-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Derived tokens */
  --fg: var(--seed-fg);
  --fg-secondary: color-mix(in srgb, var(--seed-fg) 60%, transparent);
  --fg-muted: var(--seed-muted);
  --surface: var(--seed-surface);
  --surface-raised: var(--seed-surface-raised);
  --surface-sunken: var(--seed-surface-sunken);
  --border: var(--seed-border);
  --border-strong: var(--seed-border-strong);
  --success: var(--seed-success);
  --warning: var(--seed-warning);
  --danger: var(--seed-danger);
  --radius: var(--seed-radius);
  --font: var(--seed-font);
  --mono: var(--seed-mono);
  --shadow-card: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.04);
  --shadow-elevated: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.04), 0 8px 8px -8px rgba(0,0,0,0.04);
  --transition: 150ms ease;
  --sidebar-w: 240px;
  --sidebar-w-collapsed: 64px;
  --topbar-h: 56px;

  /* Backward-compatible aliases for child components */
  --bg: var(--seed-bg);
  --text-primary: var(--seed-fg);
  --text-secondary: var(--seed-muted);
  --text-muted: var(--seed-muted);
  --text-link: var(--seed-primary);
  --surface: var(--seed-surface);
  --surface-soft: var(--seed-surface-sunken);
  --surface-raised: var(--seed-surface-raised);
  --border: var(--seed-border);
  --border-strong: var(--seed-border-strong);
  --input-bg: var(--seed-surface);
  --header-bg: color-mix(in srgb, var(--seed-surface) 85%, transparent);
  --bubble-bg: var(--seed-surface-sunken);
  --hover-bg: var(--seed-surface-sunken);
  --accent: var(--seed-success);
  --accent-strong: var(--seed-success);
  --accent-soft: color-mix(in srgb, var(--seed-success) 10%, transparent);
  --info: var(--seed-primary);
  --warn: var(--seed-warning);
  --danger: var(--seed-danger);
  --shadow-sm: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.04), 0 8px 8px -8px rgba(0,0,0,0.04);
}

/* --- Dark Theme --- */
.admin-root.dark {
  --seed-bg: #000000;
  --seed-fg: #ededed;
  --seed-primary: #3291ff;
  --seed-surface: #0a0a0a;
  --seed-surface-raised: #111111;
  --seed-surface-sunken: #080808;
  --seed-border: rgba(255, 255, 255, 0.08);
  --seed-border-strong: #262626;
  --seed-muted: #888888;
  --seed-success: #22c55e;
  --seed-warning: #f5a623;
  --seed-danger: #ff5b4f;
  --shadow-card: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.2);
  --shadow-elevated: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.2), 0 8px 8px -8px rgba(0,0,0,0.16);

  /* Dark backward-compatible aliases */
  --bg: var(--seed-bg);
  --text-primary: var(--seed-fg);
  --text-secondary: var(--seed-muted);
  --text-muted: var(--seed-muted);
  --text-link: var(--seed-primary);
  --surface: var(--seed-surface);
  --surface-soft: var(--seed-surface-sunken);
  --surface-raised: var(--seed-surface-raised);
  --border: var(--seed-border);
  --border-strong: var(--seed-border-strong);
  --input-bg: var(--seed-surface);
  --header-bg: color-mix(in srgb, var(--seed-surface) 85%, transparent);
  --bubble-bg: var(--seed-surface-sunken);
  --hover-bg: var(--seed-surface-sunken);
  --accent: var(--seed-success);
  --accent-strong: var(--seed-success);
  --accent-soft: color-mix(in srgb, var(--seed-success) 10%, transparent);
  --info: var(--seed-primary);
  --warn: var(--seed-warning);
  --danger: var(--seed-danger);
  --shadow-sm: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.2);
  --shadow-md: 0 0 0 1px var(--seed-border), 0 2px 2px rgba(0,0,0,0.2), 0 8px 8px -8px rgba(0,0,0,0.16);
}

/* --- Root Layout --- */
.admin-root {
  display: flex;
  min-height: 100vh;
  font-family: var(--font);
  font-size: 14px;
  color: var(--fg);
  background: var(--seed-bg);
  -webkit-font-smoothing: antialiased;
  transition: background var(--transition), color var(--transition);
}

/* --- Sidebar --- */
.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--sidebar-w);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--border);
  z-index: 20;
  transition: width var(--transition);
  overflow: hidden;
}

.sidebar.collapsed {
  width: var(--sidebar-w-collapsed);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--topbar-h);
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.brand-icon {
  width: 24px;
  height: 24px;
  color: var(--fg);
  flex-shrink: 0;
}

.brand-text {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.3px;
  white-space: nowrap;
}

.sidebar-toggle {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.sidebar-toggle:hover {
  background: var(--surface-sunken);
  color: var(--fg);
}

.sidebar-nav {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background var(--transition), color var(--transition);
}

.nav-item:hover {
  background: var(--surface-sunken);
  color: var(--fg);
}

.nav-item.active {
  background: var(--surface-sunken);
  color: var(--fg);
  font-weight: 600;
}

.nav-item svg {
  flex-shrink: 0;
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.sidebar-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
}

.sidebar-action:hover {
  background: var(--surface-sunken);
  color: var(--fg);
}

.sidebar-links {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
}

.ext-link {
  font-size: 12px;
  color: var(--fg-muted);
  text-decoration: none;
}

.ext-link:hover {
  color: var(--fg);
}

.user-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin-top: 4px;
  border-top: 1px solid var(--border);
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
  flex-shrink: 0;
}

.user-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-email {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 11px;
  color: var(--fg-muted);
}

/* --- Main Area --- */
.main-area {
  flex: 1;
  margin-left: var(--sidebar-w);
  transition: margin-left var(--transition);
  min-width: 0;
}

.sidebar.collapsed ~ .main-area {
  margin-left: var(--sidebar-w-collapsed);
}

/* --- Topbar --- */
.topbar {
  position: sticky;
  top: 0;
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  z-index: 10;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.32px;
}

.mode-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
}

.mode-switch button {
  padding: 4px 12px;
  border: none;
  border-radius: calc(var(--radius) - 2px);
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.mode-switch button.active {
  background: var(--surface);
  color: var(--fg);
  box-shadow: var(--shadow-card);
}

/* --- Auth States --- */
.auth-state {
  display: grid;
  place-items: center;
  gap: 12px;
  min-height: 400px;
  text-align: center;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--seed-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* --- Content --- */
.content {
  padding: 24px;
  max-width: 1400px;
}

.view-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* --- Feedback --- */
.feedback {
  min-height: 0;
}

.feedback-msg {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}

.feedback-msg.error {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

.feedback-msg.success {
  background: color-mix(in srgb, var(--success) 10%, transparent);
  color: var(--success);
}

/* --- Cards --- */
.card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  padding: 20px;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.32px;
}

.card-subtitle {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--fg-muted);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* --- KPI Grid --- */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.kpi-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
.kpi-grid.cols-5 { grid-template-columns: repeat(5, 1fr); }
.kpi-grid.cols-6 { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }

.kpi-item {
  padding: 12px 14px;
  background: var(--surface);
}

.kpi-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.kpi-value {
  display: block;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.48px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kpi-value.sm {
  font-size: 15px;
  font-weight: 600;
}

.kpi-sub {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
}

.cost-big {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.96px;
  white-space: nowrap;
}

.cost-big small {
  font-size: 13px;
  font-weight: 400;
  color: var(--fg-muted);
}

/* --- Two Column Layout --- */
.two-col {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: 16px;
}

/* --- Buttons --- */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius);
  background: var(--fg);
  color: var(--surface);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity var(--transition);
}

.btn-primary:hover { opacity: 0.85; }
.btn-primary:disabled { opacity: 0.4; cursor: default; }

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--fg);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: var(--shadow-card);
  transition: background var(--transition);
}

.btn-secondary:hover { background: var(--surface-sunken); }
.btn-secondary:disabled { opacity: 0.4; cursor: default; }

.btn-ghost {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.btn-ghost:hover { background: var(--surface-sunken); color: var(--fg); }
.btn-ghost:disabled { opacity: 0.4; cursor: default; }

button:disabled { cursor: default; }

/* --- Inputs --- */
input, select, textarea {
  width: 100%;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font);
  font-size: 13px;
  box-shadow: var(--shadow-card);
  transition: border-color var(--transition);
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--seed-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--seed-primary) 20%, transparent);
}

.input-sm {
  max-width: 140px;
  min-height: 30px;
  font-size: 12px;
}

textarea {
  resize: vertical;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
}

select {
  cursor: pointer;
  min-width: 100px;
}

/* --- Filter Group --- */
.filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* --- Search Row --- */
.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 12px;
}

/* --- Inline Form --- */
.inline-form {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.inline-form > * { flex: 1; min-width: 100px; }
.inline-form > button { flex: 0 0 auto; }

/* --- Form Grid --- */
.form-grid {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

.form-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-field.full { grid-column: 1 / -1; }

.form-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-muted);
}

.form-actions {
  display: flex;
  align-items: flex-end;
}

/* --- Settings Form --- */
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-sunken);
  cursor: pointer;
}

.check-row input[type="checkbox"] {
  width: auto;
  min-height: auto;
  box-shadow: none;
}

.check-row span {
  font-size: 13px;
  color: var(--fg);
}

.cost-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.cost-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 3px 8px;
  border-radius: var(--radius);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--fg-muted);
}

.compact-table table {
  min-width: 720px;
}

.summary-grid.mini {
  margin-top: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* --- Announcement Form --- */
.announcement-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

/* --- Tables --- */
.table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th, td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

th {
  background: var(--surface-sunken);
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--surface-sunken); }

.empty-cell {
  text-align: center;
  color: var(--fg-muted);
  padding: 24px 12px;
}

.ann-body-cell {
  max-width: 400px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: var(--fg-secondary);
}

/* --- User List --- */
.user-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 480px;
  overflow-y: auto;
}

.user-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 38px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--fg);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  width: 100%;
  transition: border-color var(--transition), background var(--transition);
}

.user-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-row:hover {
  border-color: var(--border-strong);
  background: var(--surface-sunken);
}

.user-row.active {
  border-color: var(--seed-primary);
  background: color-mix(in srgb, var(--seed-primary) 6%, transparent);
}

/* --- Badges --- */
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: var(--radius);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--surface-sunken);
  color: var(--fg-secondary);
  border: 1px solid var(--border);
}

.badge.positive {
  background: color-mix(in srgb, var(--success) 10%, transparent);
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 20%, transparent);
}

.badge.negative {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 20%, transparent);
}

.badge.muted {
  background: var(--surface-sunken);
  color: var(--fg-muted);
}

/* --- Status Pill --- */
.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 4px 10px;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--surface-sunken);
  color: var(--fg-muted);
}

.status-pill.ok {
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
  background: color-mix(in srgb, var(--success) 10%, transparent);
  color: var(--success);
}

.status-pill.warning {
  border-color: color-mix(in srgb, var(--warning) 30%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  color: #b45309;
}

.status-pill.error {
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

/* --- Action Group --- */
.action-group {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

/* --- Created Output --- */
.created-output {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.created-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

/* --- Warning List --- */
.warning-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.warning-item {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 4px 10px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 20%, transparent);
  font-size: 12px;
  color: var(--warning);
}

.warning-item.ok {
  background: color-mix(in srgb, var(--success) 10%, transparent);
  border-color: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
}

/* --- Section Divider --- */
.section-divider {
  height: 1px;
  background: var(--border);
  margin: 16px 0;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

/* --- Utility --- */
.text-positive { color: var(--success) !important; font-weight: 600; }
.text-negative { color: var(--danger) !important; font-weight: 600; }
.text-muted { color: var(--fg-muted); }
.text-caption { font-size: 12px; color: var(--fg-muted); }
.text-mono { font-family: var(--mono); font-size: 13px; font-weight: 500; }
.text-title { font-weight: 600; }
.empty-state { padding: 24px; text-align: center; color: var(--fg-muted); }
.hint-text { font-size: 13px; color: var(--fg-muted); margin-bottom: 12px; }

/* --- Responsive --- */
@media (max-width: 1024px) {
  .sidebar {
    width: var(--sidebar-w-collapsed);
  }
  .main-area {
    margin-left: var(--sidebar-w-collapsed);
  }
  .sidebar .brand-text,
  .sidebar .nav-label,
  .sidebar .sidebar-action span,
  .sidebar .sidebar-links,
  .sidebar .user-badge {
    display: none;
  }
  .two-col { grid-template-columns: 1fr; }
  .kpi-grid.cols-4,
  .kpi-grid.cols-5 { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 768px) {
  .content { padding: 16px; }
  .topbar { padding: 0 16px; }
  .kpi-grid,
  .kpi-grid.cols-4,
  .kpi-grid.cols-5,
  .kpi-grid.cols-6 { grid-template-columns: repeat(2, 1fr); }
  .form-grid.cols-3 { grid-template-columns: 1fr; }
  .inline-form { flex-direction: column; }
  .inline-form > * { min-width: auto; }
  .filter-group { flex-direction: column; align-items: stretch; }
  .filter-group select, .filter-group input { max-width: none; }
}
</style>
