<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  LayoutDashboard,
  Coins,
  Image,
  Activity,
  Server,
  Megaphone,
  Settings,
  ChevronLeft,
  ChevronRight,
  Globe,
  Moon,
  Sun,
  Zap,
} from '@lucide/vue'
import AdminImageAttemptsPanel from '../components/admin/AdminImageAttemptsPanel.vue'
import AdminImagesPanel from '../components/admin/AdminImagesPanel.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  ImageProviderCompatibilityMode,
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
  { id: 'overview', labelKey: 'nav.overview', icon: LayoutDashboard },
  { id: 'credits', labelKey: 'nav.credits', icon: Coins },
  { id: 'images', labelKey: 'nav.images', icon: Image },
  { id: 'monitor', labelKey: 'nav.monitor', icon: Activity },
  { id: 'system', labelKey: 'nav.system', icon: Server },
  { id: 'announcements', labelKey: 'nav.announcements', icon: Megaphone },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
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
  imageCompatibilityMode: 'auto' as ImageProviderCompatibilityMode,
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
    imageCompatibilityMode: 'auto',
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
    imageCompatibilityMode: provider.imageCompatibilityMode,
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
    ...(providerForm.value.kind === 'image'
      ? { imageCompatibilityMode: providerForm.value.imageCompatibilityMode }
      : {}),
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

function providerCompatibilityLabel(provider: AdminProviderSetting) {
  if (provider.kind !== 'image') return '-'
  if (provider.imageCompatibilityMode === 'openai') return '标准 OpenAI'
  if (provider.imageCompatibilityMode === 'lucen') return 'Lucen / sub2api'
  return '自动判断'
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
  <div class="flex min-h-screen text-sm transition-colors duration-150" :class="{ dark: isDark }">
    <!-- Sidebar -->
    <aside
      class="fixed top-0 left-0 bottom-0 z-20 flex flex-col bg-[var(--surface)] border-r border-[var(--border)] overflow-hidden transition-[width] duration-150"
      :class="sidebarCollapsed ? 'w-16' : 'w-[240px] max-lg:w-16'"
    >
      <div class="flex items-center justify-between h-14 px-4 border-b border-[var(--border)] shrink-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <Zap class="w-6 h-6 shrink-0" />
          <span v-show="!sidebarCollapsed" class="text-[15px] font-semibold tracking-tight whitespace-nowrap max-lg:hidden">Recho Admin</span>
        </div>
        <Button variant="ghost" size="icon-xs" class="shrink-0" @click="toggleSidebar">
          <ChevronLeft v-if="!sidebarCollapsed" class="w-4 h-4" />
          <ChevronRight v-else class="w-4 h-4" />
        </Button>
      </div>

      <nav class="flex-1 p-2 overflow-y-auto">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="flex items-center gap-2.5 w-full min-h-9 px-2.5 rounded-md border-0 bg-transparent text-[var(--text-secondary)] text-[13px] font-medium cursor-pointer text-left whitespace-nowrap transition-colors duration-150 hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
          :class="{ 'bg-[var(--hover-bg)] text-[var(--text-primary)] font-semibold': activeView === item.id }"
          @click="activeView = item.id"
        >
          <component :is="item.icon" class="w-5 h-5 shrink-0" stroke-width="1.5" />
          <span v-show="!sidebarCollapsed" class="overflow-hidden text-ellipsis max-lg:hidden">{{ t(item.labelKey) }}</span>
        </button>
      </nav>

      <div class="p-2 border-t border-[var(--border)] flex flex-col gap-0.5 shrink-0">
        <button class="flex items-center gap-2.5 w-full min-h-8 px-2.5 rounded-md border-0 bg-transparent text-[var(--text-muted)] text-xs cursor-pointer text-left whitespace-nowrap hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors" @click="toggleLocale">
          <Globe class="w-4 h-4" stroke-width="1.5" />
          <span v-show="!sidebarCollapsed" class="max-lg:hidden">{{ locale === 'zh' ? '中文' : 'EN' }}</span>
        </button>
        <button class="flex items-center gap-2.5 w-full min-h-8 px-2.5 rounded-md border-0 bg-transparent text-[var(--text-muted)] text-xs cursor-pointer text-left whitespace-nowrap hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors" @click="toggleTheme">
          <Moon v-if="!isDark" class="w-4 h-4" stroke-width="1.5" />
          <Sun v-else class="w-4 h-4" stroke-width="1.5" />
          <span v-show="!sidebarCollapsed" class="max-lg:hidden">{{ isDark ? t('common.lightMode') : t('common.darkMode') }}</span>
        </button>
        <div v-show="!sidebarCollapsed" class="flex gap-2 px-2.5 py-1.5 max-lg:hidden">
          <RouterLink to="/image" class="text-xs text-[var(--text-muted)] no-underline hover:text-[var(--text-primary)]">{{ t('nav.canvas') }}</RouterLink>
          <RouterLink to="/works" class="text-xs text-[var(--text-muted)] no-underline hover:text-[var(--text-primary)]">{{ t('nav.works') }}</RouterLink>
        </div>
        <div v-if="user && !sidebarCollapsed" class="flex items-center gap-2.5 p-2 mt-1 border-t border-[var(--border)] max-lg:hidden">
          <div class="w-7 h-7 rounded-full bg-[var(--bubble-bg)] border border-[var(--border)] grid place-items-center text-xs font-semibold shrink-0">{{ (userEmail || 'A').charAt(0).toUpperCase() }}</div>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap">{{ userEmail || 'Admin' }}</span>
            <span class="text-[11px] text-[var(--text-muted)]">{{ currentAdminRole === 'senior' ? t('settings.seniorAdmin') : t('settings.operator') }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Area -->
    <div class="flex-1 min-w-0 transition-[margin-left] duration-150" :class="sidebarCollapsed ? 'ml-16' : 'ml-[240px] max-lg:ml-16'">
      <!-- Top Bar -->
      <header class="sticky top-0 z-10 h-14 flex items-center justify-between px-6 bg-[var(--header-bg)] backdrop-blur-md border-b border-[var(--border)] max-md:px-4">
        <div class="flex items-center gap-4">
          <h1 class="text-base font-semibold tracking-tight">{{ t(`nav.${activeView}`) }}</h1>
          <div class="flex gap-0.5 p-0.5 rounded-md bg-[var(--bubble-bg)] border border-[var(--border)]" role="group">
            <button class="px-3 py-1 rounded-[calc(var(--radius)-2px)] border-0 bg-transparent text-[var(--text-muted)] text-xs font-medium cursor-pointer whitespace-nowrap" :class="{ 'bg-[var(--surface)] text-[var(--text-primary)] shadow-sm': adminMode === 'visual' }" @click="adminMode = 'visual'">{{ t('mode.visual') }}</button>
            <button class="px-3 py-1 rounded-[calc(var(--radius)-2px)] border-0 bg-transparent text-[var(--text-muted)] text-xs font-medium cursor-pointer whitespace-nowrap" :class="{ 'bg-[var(--surface)] text-[var(--text-primary)] shadow-sm': adminMode === 'manage' }" @click="adminMode = 'manage'">{{ t('mode.manage') }}</button>
          </div>
        </div>
      </header>

      <!-- Auth States -->
      <div v-if="!isAuthReady || !adminChecked" class="grid place-items-center gap-3 min-h-[400px] text-center">
        <span class="w-5 h-5 border-2 border-[var(--border)] border-t-[var(--seed-primary)] rounded-full animate-spin" />
        <strong>{{ t('auth.checking') }}</strong>
      </div>

      <div v-else-if="!user" class="grid place-items-center gap-3 min-h-[400px] text-center">
        <strong>{{ t('auth.loginRequired') }}</strong>
        <RouterLink to="/image" class="inline-flex items-center justify-center min-h-8 px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13px] font-medium shadow-sm no-underline hover:bg-[var(--hover-bg)]">{{ t('auth.loginLink') }}</RouterLink>
      </div>

      <div v-else-if="!isAdmin" class="grid place-items-center gap-3 min-h-[400px] text-center">
        <strong>{{ errorMessage || t('auth.noAccess') }}</strong>
        <span class="text-[var(--text-muted)]">{{ userEmail }}</span>
      </div>

      <!-- Content -->
      <main v-else class="p-6 max-w-[1400px] max-md:p-4">
        <!-- Feedback Messages -->
        <div class="min-h-0" aria-live="polite">
          <p v-if="errorMessage" class="inline-flex items-center min-h-8 px-3 rounded-md text-[13px] font-medium mb-2 bg-red-500/10 text-red-500">{{ errorMessage }}</p>
          <p v-if="noticeMessage" class="inline-flex items-center min-h-8 px-3 rounded-md text-[13px] font-medium mb-2 bg-emerald-500/10 text-emerald-600">{{ noticeMessage }}</p>
        </div>

        <!-- ===== OVERVIEW ===== -->
        <section v-if="activeView === 'overview'" class="flex flex-col gap-4">
          <!-- KPI Grid -->
          <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 class="text-sm font-semibold tracking-tight">{{ t('overview.title') }}</h2>
                <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ overviewGeneratedAt }}</span>
              </div>
              <Button variant="outline" size="sm" :disabled="overviewLoading" @click="refreshOverview">{{ t('common.refresh') }}</Button>
            </div>
            <div class="grid gap-px bg-[var(--border)] border border-[var(--border)] rounded-md overflow-hidden" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.totalBalance') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ creditAmount(overview?.users.totalBalance) }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.totalRedeemed') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ creditAmount(overview?.users.totalRedeemed) }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.totalSpent') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ creditAmount(overview?.users.totalSpent) }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.imageCostPerImage') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ creditAmount(overview?.settings.imageCreditCostPerImage ?? 1) }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.availableCodes') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ overviewCodeHealth }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.redeemedCodeCredits') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ creditAmount(overview?.codes.totalRedeemedCredits) }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.weeklyTxns') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ overview?.transactions.last7Days.totalCount ?? 0 }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.weeklySpend') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{{ creditAmount(overview?.transactions.last7Days.spentCredits) }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.weeklyNet') }}</span>
                <strong class="block text-xl font-semibold tracking-tight leading-tight overflow-hidden text-ellipsis whitespace-nowrap" :class="overviewNetChange >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ signedCreditAmount(overviewNetChange) }}</strong>
              </div>
            </div>
          </div>

          <!-- Image Cost Panel -->
          <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 class="text-sm font-semibold tracking-tight">{{ t('overview.imageCost') }}</h2>
                <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ t('overview.payAsYouGo') }} · {{ t('overview.confidence') }} {{ imageCostConfidenceLabel }}</span>
              </div>
              <span class="text-2xl font-semibold tracking-tight whitespace-nowrap">¥{{ overview?.imageCost?.totalCostPerImage?.toFixed(4) ?? '0.0000' }}<small class="text-[13px] font-normal text-[var(--text-muted)]">{{ t('overview.imageCostUnit') }}</small></span>
            </div>
            <div class="grid gap-px bg-[var(--border)] border border-[var(--border)] rounded-md overflow-hidden" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.cosStoragePerImage') }}</span>
                <strong class="block text-[15px] font-semibold">¥{{ overview?.imageCost?.cosStorageCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.cosTrafficPerImage') }}</span>
                <strong class="block text-[15px] font-semibold">¥{{ overview?.imageCost?.cosTrafficCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.supabaseStoragePerImage') }}</span>
                <strong class="block text-[15px] font-semibold">¥{{ overview?.imageCost?.supabaseStorageCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.supabaseTrafficPerImage') }}</span>
                <strong class="block text-[15px] font-semibold">¥{{ overview?.imageCost?.supabaseTrafficCostPerImage?.toFixed(4) ?? '0.0000' }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.estimatedMonthlyCost') }}</span>
                <strong class="block text-[15px] font-semibold">¥{{ overview?.imageCost?.estimatedMonthlyCost?.toFixed(2) ?? '0.00' }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('overview.sampleCount') }}</span>
                <strong class="block text-[15px] font-semibold">{{ overview?.imageCost?.cosImageCount ?? 0 }} COS / {{ overview?.imageCost?.supabaseImageCount ?? 0 }} SB</strong>
              </div>
            </div>
          </div>

          <!-- Ledger -->
          <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 class="text-sm font-semibold tracking-tight">{{ t('credits.ledger.title') }}</h2>
                <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ ledgerTransactions.length }}</span>
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <select v-model="ledgerReason" :disabled="ledgerLoading" class="min-h-8 min-w-[100px] cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-[13px]" @change="refreshLedger">
                  <option value="">{{ t('credits.ledger.allTypes') }}</option>
                  <option value="redemption">{{ t('credits.transactionReason.redemption') }}</option>
                  <option value="image_generation">{{ t('credits.transactionReason.image_generation') }}</option>
                  <option value="refund">{{ t('credits.transactionReason.refund') }}</option>
                  <option value="admin_adjustment">{{ t('credits.transactionReason.admin_adjustment') }}</option>
                </select>
                <select v-model="ledgerHours" :disabled="ledgerLoading" class="min-h-8 min-w-[100px] cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-[13px]" @change="refreshLedger">
                  <option value="24">{{ t('credits.ledger.last24h') }}</option>
                  <option value="168">{{ t('credits.ledger.last7d') }}</option>
                  <option value="720">{{ t('credits.ledger.last30d') }}</option>
                  <option value="">{{ t('credits.ledger.allTime') }}</option>
                </select>
                <input v-model="ledgerUserId" type="search" :placeholder="t('credits.ledger.userIdFilter')" :disabled="ledgerLoading" class="min-h-8 max-w-[140px] min-w-[100px] rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-xs" @keyup.enter="refreshLedger">
                <Button variant="outline" size="sm" :disabled="ledgerLoading" @click="refreshLedger">{{ t('common.refresh') }}</Button>
              </div>
            </div>
            <div class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
              <table class="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.time') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.user') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.type') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.change') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.balance') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.details') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.note') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tx in ledgerTransactions" :key="tx.id" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                    <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(tx.createdAt) }}</td>
                    <td class="px-3 py-2">{{ tx.email || shortId(tx.userId) }}</td>
                    <td class="px-3 py-2"><Badge variant="secondary">{{ transactionReason(tx.reason) }}</Badge></td>
                    <td class="px-3 py-2 font-mono text-[13px] font-medium" :class="tx.amount >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ signedCreditAmount(tx.amount) }}</td>
                    <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ creditAmount(tx.balanceAfter) }}</td>
                    <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ ledgerDetails(tx) }}</td>
                    <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ tx.note || '-' }}</td>
                  </tr>
                  <tr v-if="!ledgerTransactions.length">
                    <td colspan="7" class="text-center text-[var(--text-muted)] py-6 px-3">{{ t('common.noData') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== CREDITS ===== -->
        <section v-else-if="activeView === 'credits'" class="flex flex-col gap-4">
          <div class="grid gap-4 max-lg:grid-cols-1" style="grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);">
            <!-- User List -->
            <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 class="text-sm font-semibold tracking-tight">{{ t('credits.users') }}</h2>
                  <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ users.length }}</span>
                </div>
                <Button variant="outline" size="sm" :disabled="loading" @click="refreshUsers">{{ t('common.refresh') }}</Button>
              </div>
              <form class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 mb-3" @submit.prevent="refreshUsers">
                <input v-model.trim="userQuery" type="search" :placeholder="t('credits.searchUsers')" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                <Button variant="outline" size="sm" type="submit" :disabled="loading">{{ t('common.search') }}</Button>
              </form>
              <div class="flex flex-col gap-1 max-h-[480px] overflow-y-auto">
                <button
                  v-for="item in users"
                  :key="item.userId"
                  class="flex items-center justify-between gap-2 min-h-[38px] px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13px] text-left cursor-pointer w-full transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--hover-bg)]"
                  :class="{ 'border-[var(--seed-primary)] bg-[color-mix(in_srgb,var(--seed-primary)_6%,transparent)]': selectedUser?.userId === item.userId }"
                  @click="selectUser(item)"
                >
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ item.email || shortId(item.userId) }}</span>
                  <strong class="font-mono text-[13px] font-medium shrink-0">{{ creditAmount(item.balance) }}</strong>
                </button>
              </div>
            </div>

            <!-- User Detail -->
            <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 class="text-sm font-semibold tracking-tight">{{ t('credits.userDetail') }}</h2>
                  <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ selectedUserTitle }}</span>
                </div>
              </div>

              <div v-if="selectedUser" class="grid gap-px bg-[var(--border)] border border-[var(--border)] rounded-md overflow-hidden mb-4" style="grid-template-columns: repeat(4, 1fr);">
                <div class="p-3 bg-[var(--surface)]">
                  <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('credits.balance') }}</span>
                  <strong class="block text-xl font-semibold tracking-tight">{{ creditAmount(selectedUser.balance) }}</strong>
                </div>
                <div class="p-3 bg-[var(--surface)]">
                  <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('credits.totalRedeemed') }}</span>
                  <strong class="block text-xl font-semibold tracking-tight">{{ creditAmount(selectedUser.totalRedeemed) }}</strong>
                </div>
                <div class="p-3 bg-[var(--surface)]">
                  <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('credits.totalSpent') }}</span>
                  <strong class="block text-xl font-semibold tracking-tight">{{ creditAmount(selectedUser.totalSpent) }}</strong>
                </div>
                <div class="p-3 bg-[var(--surface)]">
                  <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('common.updatedAt') }}</span>
                  <strong class="block text-[15px] font-semibold">{{ dateTime(selectedUser.updatedAt) }}</strong>
                </div>
              </div>

              <form class="flex gap-2 items-end flex-wrap mb-4" @submit.prevent="submitAdjustment">
                <input v-model.number="adjustAmount" type="number" step="1" :placeholder="t('credits.adjustPlaceholder')" class="min-h-[30px] max-w-[140px] rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-xs flex-1 min-w-[100px]">
                <input v-model.trim="adjustNote" type="text" :placeholder="t('credits.adjustNotePlaceholder')" class="min-h-[30px] max-w-[140px] rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-xs flex-1 min-w-[100px]">
                <Button type="submit" :disabled="actionLoading || !selectedUser || !adjustAmount">{{ t('common.submit') }}</Button>
              </form>

              <div class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
                <table class="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.time') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.type') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.change') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.balance') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.note') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="tx in transactions" :key="tx.id" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(tx.created_at) }}</td>
                      <td class="px-3 py-2"><Badge variant="secondary">{{ transactionReason(tx.reason) }}</Badge></td>
                      <td class="px-3 py-2 font-mono text-[13px] font-medium" :class="tx.amount >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ signedCreditAmount(tx.amount) }}</td>
                      <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ creditAmount(tx.balance_after) }}</td>
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ transactionNote(tx) }}</td>
                    </tr>
                    <tr v-if="!transactions.length">
                      <td colspan="5" class="text-center text-[var(--text-muted)] py-6 px-3">{{ t('common.noData') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Codes Section -->
          <div class="grid gap-4 max-lg:grid-cols-1" style="grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);">
            <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
              <div class="flex items-start justify-between gap-3 mb-4">
                <h2 class="text-sm font-semibold tracking-tight">{{ t('credits.generateCodes') }}</h2>
                <span class="text-xs text-[var(--text-muted)]">{{ codeForm.count }} {{ t('credits.codeCount') }}</span>
              </div>
              <form class="grid gap-2.5 mb-4" style="grid-template-columns: repeat(3, 1fr);" @submit.prevent="createCodes">
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('credits.prefix') }}</span>
                  <input v-model.trim="codeForm.prefix" type="text" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('credits.creditsPerCode') }}</span>
                  <input v-model.number="codeForm.credits" type="number" min="1" step="1" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('credits.quantity') }}</span>
                  <input v-model.number="codeForm.count" type="number" min="1" max="100" step="1" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('credits.maxRedemptions') }}</span>
                  <input v-model.number="codeForm.maxRedemptions" type="number" min="1" step="1" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('credits.validDays') }}</span>
                  <input v-model.number="codeForm.days" type="number" min="1" step="1" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('common.note') }}</span>
                  <input v-model.trim="codeForm.note" type="text" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <div class="flex items-end" style="grid-column: 1 / -1;">
                  <Button type="submit" :disabled="actionLoading">{{ t('common.generate') }}</Button>
                </div>
              </form>

              <div v-if="createdCodes.length" class="mt-4 pt-4 border-t border-[var(--border)]">
                <div class="flex items-center gap-2 mb-2.5">
                  <strong>{{ t('credits.thisBatch') }}</strong>
                  <Button variant="ghost" size="sm" @click="copyCreatedCsv">{{ t('credits.copyCsv') }}</Button>
                  <Button variant="ghost" size="sm" @click="downloadCreatedCsv">{{ t('credits.downloadCsv') }}</Button>
                </div>
                <textarea :value="createdCsv" readonly rows="6" class="w-full min-h-8 p-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-xs font-mono resize-y" />
              </div>
            </div>

            <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 class="text-sm font-semibold tracking-tight">{{ t('credits.codes') }}</h2>
                  <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ codes.length }}</span>
                </div>
                <Button variant="outline" size="sm" :disabled="loading" @click="refreshCodes">{{ t('common.refresh') }}</Button>
              </div>
              <div class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
                <table class="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.created') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.credits') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.usage') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.status') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.note') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="code in codes" :key="code.id" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(code.createdAt) }}</td>
                      <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ code.credits }}</td>
                      <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ code.redeemedCount }} / {{ code.maxRedemptions }}</td>
                      <td class="px-3 py-2">
                        <Badge :variant="codeStatus(code) === t('credits.codeStatus.available') ? 'default' : 'destructive'">{{ codeStatus(code) }}</Badge>
                      </td>
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ code.note || '-' }}</td>
                      <td class="px-3 py-2">
                        <div class="flex gap-1 flex-wrap">
                          <Button variant="ghost" size="sm" :disabled="codeRedemptionsLoading && selectedCode?.id === code.id" @click="viewCodeRedemptions(code)">{{ t('common.details') }}</Button>
                          <Button variant="ghost" size="sm" :disabled="actionLoading" @click="setCodeDisabled(code, !code.disabledAt)">{{ code.disabledAt ? t('common.restore') : t('common.disable') }}</Button>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="!codes.length">
                      <td colspan="6" class="text-center text-[var(--text-muted)] py-6 px-3">{{ t('common.noData') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="selectedCode" class="mt-4 pt-4 border-t border-[var(--border)]">
                <div class="flex items-center gap-2 mb-2.5">
                  <strong>{{ t('credits.codeRedemptions') }}</strong>
                  <span class="text-[var(--text-muted)]">{{ selectedCode.redeemedCount }} / {{ selectedCode.maxRedemptions }}</span>
                  <Button variant="ghost" size="sm" :disabled="codeRedemptionsLoading" @click="viewCodeRedemptions(selectedCode!)">{{ t('common.refresh') }}</Button>
                </div>
                <div class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
                  <table class="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.time') }}</th>
                        <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.user') }}</th>
                        <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.credits') }}</th>
                        <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('credits.table.balance') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in codeRedemptions" :key="r.id" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                        <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(r.redeemedAt) }}</td>
                        <td class="px-3 py-2">{{ r.email || shortId(r.userId) }}</td>
                        <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ r.credits }}</td>
                        <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ r.balanceAfter ?? '-' }}</td>
                      </tr>
                      <tr v-if="!codeRedemptions.length">
                        <td colspan="4" class="text-center text-[var(--text-muted)] py-6 px-3">{{ codeRedemptionsLoading ? t('common.loading') : t('common.noData') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ===== IMAGES ===== -->
        <section v-else-if="activeView === 'images'" class="flex flex-col gap-4">
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

          <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 class="text-sm font-semibold tracking-tight">{{ t('images.storageOverview') }}</h2>
                <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ storageOverview ? `${storageOverview.totalImages} ${t('images.imageCount')} / ${formatByteSize(storageOverview.totalBytes)}` : t('common.loading') }}</span>
              </div>
              <Button variant="outline" size="sm" :disabled="storageOverviewLoading" @click="refreshStorageOverview">{{ t('common.refresh') }}</Button>
            </div>
            <div v-if="storageOverviewLoading" class="p-6 text-center text-[var(--text-muted)]">{{ t('images.statistics') }}</div>
            <div v-else-if="storageOverview" class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
              <table class="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('images.storageLocation') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('images.imageCount') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('images.totalSize') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('images.avgSize') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('images.totalCredits') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('images.sizePercent') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="stat in storageOverview.byLocation" :key="stat.location" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                    <td class="px-3 py-2">{{ storageLocationLabel(stat.location) }}</td>
                    <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ stat.imageCount }}</td>
                    <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ formatByteSize(stat.totalBytes) }}</td>
                    <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ formatByteSize(stat.averageBytes) }}</td>
                    <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ formatCreditAmount(stat.totalCreditCost) }}</td>
                    <td class="px-3 py-2">{{ storageOverview.totalBytes > 0 ? `${(stat.totalBytes / storageOverview.totalBytes * 100).toFixed(1)}%` : '0%' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== MONITOR ===== -->
        <section v-else-if="activeView === 'monitor'" class="flex flex-col gap-4">
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
        <section v-else-if="activeView === 'system'" class="flex flex-col gap-4">
          <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 class="text-sm font-semibold tracking-tight">{{ t('system.title') }}</h2>
                <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ systemGeneratedAt }}</span>
              </div>
              <div class="flex items-center gap-2">
                <Badge :variant="systemStatus?.status === 'ok' ? 'default' : 'destructive'">{{ systemStatusLabel }}</Badge>
                <Button variant="outline" size="sm" :disabled="systemLoading" @click="refreshSystem">{{ t('common.refresh') }}</Button>
              </div>
            </div>
            <div class="grid gap-px bg-[var(--border)] border border-[var(--border)] rounded-md overflow-hidden" style="grid-template-columns: repeat(5, 1fr);">
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.supabaseBackend') }}</span>
                <strong class="block text-[15px] font-semibold" :class="systemStatus ? (systemStatus.config.supabase.adminConfigured ? 'text-emerald-600' : 'text-red-500') : ''">
                  {{ systemStatus ? (systemStatus.config.supabase.adminConfigured ? t('system.ready') : t('system.notReady')) : '-' }}
                </strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.imageService') }}</span>
                <strong class="block text-[15px] font-semibold" :class="systemStatus ? (systemStatus.config.imageGeneration.apiKeyConfigured ? 'text-emerald-600' : 'text-red-500') : ''">
                  {{ systemStatus ? (systemStatus.config.imageGeneration.apiKeyConfigured ? t('system.ready') : t('system.notReady')) : '-' }}
                </strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.adminRules') }}</span>
                <strong class="block text-[15px] font-semibold">{{ systemStatus ? systemStatus.config.adminUsers.databaseCount + systemStatus.config.adminUsers.envUserIdCount + systemStatus.config.adminUsers.envEmailCount : '-' }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.imageMonitor') }}</span>
                <strong class="block text-[15px] font-semibold">{{ systemStatus ? (systemStatus.config.imageGeneration.analyticsEnabled ? t('system.enabled') : t('system.disabled')) : '-' }}</strong>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.imageCostPerImage') }}</span>
                <strong class="block text-[15px] font-semibold">{{ systemStatus?.config.imageGeneration.creditCostPerImage ?? 1 }}</strong>
              </div>
            </div>

            <div class="h-px bg-[var(--border)] my-4" />
            <h3 class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2.5">{{ t('system.storageStats') }}</h3>
            <div class="grid gap-px bg-[var(--border)] border border-[var(--border)] rounded-md overflow-hidden" style="grid-template-columns: repeat(4, 1fr);">
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.cosStorage') }}</span>
                <strong class="block text-[15px] font-semibold">{{ overview?.imageCost?.cosImageCount ?? 0 }} 张</strong>
                <span class="block mt-0.5 text-[11px] text-[var(--text-muted)]">{{ t('system.avgPerImage') }} {{ (overview?.imageCost?.averageStoredMb ?? 0).toFixed(2) }} MB</span>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.supabaseStorage') }}</span>
                <strong class="block text-[15px] font-semibold">{{ overview?.imageCost?.supabaseImageCount ?? 0 }} 张</strong>
                <span class="block mt-0.5 text-[11px] text-[var(--text-muted)]">{{ t('system.sampleDays') }} {{ overview?.imageCost?.sampleDays ?? 0 }} 天</span>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.estimatedMonthlyCost') }}</span>
                <strong class="block text-[15px] font-semibold">¥{{ overview?.imageCost?.estimatedMonthlyCost?.toFixed(2) ?? '0.00' }}</strong>
                <span class="block mt-0.5 text-[11px] text-[var(--text-muted)]">{{ t('overview.confidence') }} {{ imageCostConfidenceLabel }}</span>
              </div>
              <div class="p-3 bg-[var(--surface)]">
                <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">{{ t('system.totalImages') }}</span>
                <strong class="block text-[15px] font-semibold">{{ (overview?.imageCost?.cosImageCount ?? 0) + (overview?.imageCost?.supabaseImageCount ?? 0) }} 张</strong>
                <span class="block mt-0.5 text-[11px] text-[var(--text-muted)]">¥{{ overview?.imageCost?.totalCostPerImage?.toFixed(4) ?? '0.0000' }}/张</span>
              </div>
            </div>

            <div class="h-px bg-[var(--border)] my-4" />
            <h3 class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2.5">{{ t('system.warnings') }}</h3>
            <div class="flex flex-wrap gap-1.5 mb-4">
              <span v-for="warning in systemStatus?.warnings || []" :key="warning" class="inline-flex items-center min-h-[26px] px-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">{{ warning }}</span>
              <span v-if="systemStatus && !systemStatus.warnings.length" class="inline-flex items-center min-h-[26px] px-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600">{{ t('system.noWarnings') }}</span>
              <span v-else-if="!systemStatus" class="inline-flex items-center min-h-[26px] px-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">{{ t('system.waitingCheck') }}</span>
            </div>

            <div class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
              <table class="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('system.table.module') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('system.table.status') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('system.table.records') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('system.table.message') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="table in systemStatus?.data.tables || []" :key="table.key" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                    <td class="px-3 py-2">{{ table.label }}</td>
                    <td class="px-3 py-2" :class="table.status === 'ok' ? 'text-emerald-600' : 'text-red-500'">{{ tableStatusLabel(table.status) }}</td>
                    <td class="px-3 py-2 font-mono text-[13px] font-medium">{{ table.count ?? '-' }}</td>
                    <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ table.message }}</td>
                  </tr>
                  <tr v-if="!(systemStatus?.data.tables || []).length">
                    <td colspan="4" class="text-center text-[var(--text-muted)] py-6 px-3">{{ t('system.noResults') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== ANNOUNCEMENTS ===== -->
        <section v-else-if="activeView === 'announcements'" class="flex flex-col gap-4">
          <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 class="text-sm font-semibold tracking-tight">{{ t('announcements.title') }}</h2>
                <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ announcements.length }}</span>
              </div>
              <Button variant="outline" size="sm" :disabled="announcementsLoading" @click="refreshAnnouncements">{{ t('common.refresh') }}</Button>
            </div>

            <form class="flex flex-col gap-2.5 mb-4 pb-4 border-b border-[var(--border)]" @submit.prevent="createAnnouncement">
              <label class="flex flex-col gap-1">
                <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('announcements.titleLabel') }}</span>
                <input v-model.trim="announcementForm.title" type="text" maxlength="120" required class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
              </label>
              <label class="flex flex-col gap-1" style="grid-column: 1 / -1;">
                <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('announcements.bodyLabel') }}</span>
                <textarea v-model.trim="announcementForm.body" rows="4" maxlength="4000" required class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-xs font-mono resize-y" />
              </label>
              <Button type="submit" :disabled="actionLoading">{{ t('announcements.publishBtn') }}</Button>
            </form>

            <div class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
              <table class="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('announcements.table.updated') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('announcements.table.status') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('announcements.table.title') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('announcements.table.body') }}</th>
                    <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('announcements.table.actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ann in announcements" :key="ann.id" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                    <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(ann.updatedAt) }}</td>
                    <td class="px-3 py-2"><Badge :variant="ann.status === 'published' ? 'default' : 'secondary'">{{ announcementStatusLabel(ann.status) }}</Badge></td>
                    <td class="px-3 py-2 font-semibold">{{ ann.title }}</td>
                    <td class="px-3 py-2 max-w-[400px] whitespace-pre-wrap break-keep-all text-xs text-[var(--text-secondary)]">{{ ann.body }}</td>
                    <td class="px-3 py-2">
                      <div class="flex gap-1 flex-wrap">
                        <Button v-if="ann.status !== 'published'" variant="ghost" size="sm" :disabled="announcementActionId === ann.id" @click="setAnnouncementStatus(ann, 'published')">{{ t('common.publish') }}</Button>
                        <Button v-if="ann.status !== 'archived'" variant="ghost" size="sm" :disabled="announcementActionId === ann.id" @click="setAnnouncementStatus(ann, 'archived')">{{ t('common.archive') }}</Button>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="!announcements.length">
                    <td colspan="5" class="text-center text-[var(--text-muted)] py-6 px-3">{{ t('common.noData') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== SETTINGS ===== -->
        <section v-else-if="activeView === 'settings'" class="flex flex-col gap-4">
          <div class="grid gap-4 max-lg:grid-cols-1" style="grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);">
            <!-- Runtime Config -->
            <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 class="text-sm font-semibold tracking-tight">{{ t('settings.runtimeConfig') }}</h2>
                  <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ appSettings ? t('settings.loaded') : t('settings.waiting') }}</span>
                </div>
                <Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button>
              </div>

              <form class="flex flex-col gap-3" @submit.prevent="saveSettings">
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.imagePrice') }}</span>
                  <input v-model.number="settingsForm.imageCreditCostPerImage" type="number" min="0.01" step="0.01" required class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                  <div class="flex flex-wrap gap-1.5 mt-1.5">
                    <span v-for="item in settingsPricePreview" :key="item.label" class="inline-flex items-center min-h-6 px-2 rounded-md bg-[var(--bubble-bg)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">{{ item.label }} {{ item.value }} 额度</span>
                  </div>
                </div>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.responseModel') }}</span>
                  <input v-model.trim="settingsForm.imageResponsesModel" type="text" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.imageModel') }}</span>
                  <input v-model.trim="settingsForm.imageResponsesImageModel" type="text" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                  <input v-model="settingsForm.imageAnalyticsEnabled" type="checkbox" class="w-auto min-h-auto">
                  <span class="text-[13px]">{{ t('settings.analytics') }}</span>
                </label>
                <label class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                  <input v-model="settingsForm.imageEventsEnabled" type="checkbox" class="w-auto min-h-auto">
                  <span class="text-[13px]">{{ t('settings.frontendEvents') }}</span>
                </label>
                <label class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                  <input v-model="settingsForm.canvasContextEnabled" type="checkbox" class="w-auto min-h-auto">
                  <span class="text-[13px]">{{ t('settings.canvasContext') }}</span>
                </label>
                <label class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                  <input v-model="settingsForm.freeGenerationEnabled" type="checkbox" class="w-auto min-h-auto">
                  <span class="text-[13px]">{{ t('settings.freeGeneration') }}</span>
                </label>
                <label class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                  <input v-model="settingsForm.guestGenerationEnabled" type="checkbox" class="w-auto min-h-auto">
                  <span class="text-[13px]">{{ t('settings.guestGeneration') }}</span>
                </label>
                <Button type="submit" :disabled="settingsSaving || !settingsLoaded">{{ settingsSaving ? t('common.saving') : t('settings.saveConfig') }}</Button>
              </form>
            </div>

            <!-- Provider Config -->
            <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 class="text-sm font-semibold tracking-tight">Provider / API Key</h2>
                  <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ providerSettings?.tableAvailable ? '数据库配置' : '仅环境变量兜底' }}</span>
                </div>
                <Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button>
              </div>

              <form v-if="canManageAdminUsers" class="flex flex-col gap-3" @submit.prevent="saveProvider">
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">类型</span>
                  <select v-model="providerForm.kind" :disabled="Boolean(providerForm.id)" class="min-h-8 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]" @change="resetProviderForm(providerForm.kind)">
                    <option value="image">Image</option>
                    <option value="chat">Chat</option>
                  </select>
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">名称</span>
                  <input v-model.trim="providerForm.name" type="text" placeholder="lucen image / OpenAI" required class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">Base URL</span>
                  <input v-model.trim="providerForm.baseUrl" type="url" placeholder="https://example.com/v1" required class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">API Key</span>
                  <input v-model.trim="providerForm.apiKey" type="password" autocomplete="new-password" :placeholder="editingProvider?.apiKeyConfigured ? `保持当前 ${editingProvider.apiKeyPreview || ''}` : '输入 API key'" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label v-if="editingProvider?.apiKeyConfigured" class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                  <input v-model="providerForm.clearApiKey" type="checkbox" class="w-auto min-h-auto">
                  <span class="text-[13px]">清空当前 API Key</span>
                </label>
                <div class="grid grid-cols-3 gap-2 max-md:grid-cols-1">
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-[var(--text-muted)]">优先级</span>
                    <input v-model.number="providerForm.priority" type="number" min="0" max="10000" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                  </label>
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-[var(--text-muted)]">超时 ms</span>
                    <input v-model.number="providerForm.timeoutMs" type="number" min="1000" max="1200000" step="1000" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                  </label>
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-[var(--text-muted)]">重试</span>
                    <input v-model.number="providerForm.retryCount" type="number" min="0" max="10" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                  </label>
                </div>
                <label v-if="providerForm.kind === 'chat'" class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">默认 Chat 模型</span>
                  <input v-model.trim="providerForm.defaultModel" type="text" placeholder="gpt-4o-mini" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <template v-else>
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-[var(--text-muted)]">生图模型</span>
                    <input v-model.trim="providerForm.imageModel" type="text" placeholder="gpt-image-2" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                  </label>
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-[var(--text-muted)]">编辑模型</span>
                    <input v-model.trim="providerForm.editModel" type="text" placeholder="gpt-image-2" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                  </label>
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-[var(--text-muted)]">兼容预设</span>
                    <select v-model="providerForm.imageCompatibilityMode" class="min-h-8 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                      <option value="auto">自动判断</option>
                      <option value="openai">标准 OpenAI</option>
                      <option value="lucen">Lucen / sub2api OAuth</option>
                    </select>
                  </label>
                  <label class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                    <input v-model="providerForm.supportsWebpReferences" type="checkbox" class="w-auto min-h-auto">
                    <span class="text-[13px]">支持 WebP 参考图</span>
                  </label>
                </template>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-[var(--text-muted)]">备注</span>
                  <input v-model.trim="providerForm.notes" type="text" placeholder="用途、限额或供应商说明" class="min-h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2.5 py-1 text-[13px]">
                </label>
                <label class="flex items-center gap-2.5 min-h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bubble-bg)] cursor-pointer">
                  <input v-model="providerForm.enabled" type="checkbox" class="w-auto min-h-auto">
                  <span class="text-[13px]">启用</span>
                </label>
                <div class="flex gap-2 flex-wrap">
                  <Button type="submit" :disabled="Boolean(providerActionId)">{{ providerActionId ? t('common.saving') : (providerForm.id ? '保存 Provider' : '新增 Provider') }}</Button>
                  <Button variant="outline" type="button" @click="resetProviderForm(providerForm.kind)">重置</Button>
                </div>
              </form>
              <p v-else class="text-[13px] text-[var(--text-muted)] mb-3">{{ t('settings.noManagePermission') }}</p>

              <div class="w-full overflow-x-auto rounded-md border border-[var(--border)] mt-4">
                <table class="w-full min-w-[720px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">类型</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">名称</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">模型</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">兼容</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">Key</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">状态</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="provider in providerRows" :key="provider.id" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                      <td class="px-3 py-2">{{ provider.kind }}</td>
                      <td class="px-3 py-2">
                        <div class="font-semibold">{{ provider.name }}</div>
                        <div class="text-xs text-[var(--text-muted)]">{{ provider.baseUrl }}</div>
                      </td>
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ provider.kind === 'image' ? (provider.imageModel || '-') : (provider.defaultModel || '-') }}</td>
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ providerCompatibilityLabel(provider) }}</td>
                      <td class="px-3 py-2">{{ provider.apiKeyConfigured ? provider.apiKeyPreview || '已配置' : '未配置' }}</td>
                      <td class="px-3 py-2">
                        <Badge :variant="provider.enabled && provider.apiKeyConfigured ? 'default' : 'secondary'">{{ providerStatusLabel(provider) }}</Badge>
                      </td>
                      <td class="px-3 py-2">
                        <Button variant="ghost" size="sm" :disabled="provider.source !== 'database' || !canManageAdminUsers" @click="editProvider(provider)">编辑</Button>
                      </td>
                    </tr>
                    <tr v-if="!providerRows.length">
                      <td colspan="7" class="text-center text-[var(--text-muted)] py-6 px-3">暂无 Provider 配置</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="grid grid-cols-2 gap-px bg-[var(--border)] border border-[var(--border)] rounded-md overflow-hidden mt-3">
                <div class="p-3 bg-[var(--surface)]">
                  <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Image Providers</span>
                  <strong class="block text-xl font-semibold tracking-tight leading-tight">{{ imageProviderRows.length }}</strong>
                </div>
                <div class="p-3 bg-[var(--surface)]">
                  <span class="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Chat Providers</span>
                  <strong class="block text-xl font-semibold tracking-tight leading-tight">{{ chatProviderRows.length }}</strong>
                </div>
              </div>
            </div>

            <!-- Admin Users -->
            <div class="rounded-md bg-[var(--surface)] shadow-sm border border-[var(--border)] p-5">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 class="text-sm font-semibold tracking-tight">{{ t('settings.adminUsers') }}</h2>
                  <span class="block mt-0.5 text-xs text-[var(--text-muted)]">{{ adminRuleTotal }}</span>
                </div>
                <Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button>
              </div>

              <form v-if="canManageAdminUsers" class="flex gap-2 items-end flex-wrap mb-4" style="grid-template-columns: repeat(4, 1fr);" @submit.prevent="createAdminRule">
                <input v-model.trim="adminUserForm.userId" type="text" :placeholder="t('settings.adminUserId')" class="min-h-[30px] rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-xs flex-1 min-w-[100px]">
                <input v-model.trim="adminUserForm.email" type="email" :placeholder="t('settings.adminEmail')" class="min-h-[30px] rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-xs flex-1 min-w-[100px]">
                <input v-model.trim="adminUserForm.note" type="text" :placeholder="t('settings.adminNote')" class="min-h-[30px] rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] px-2 py-1 text-xs flex-1 min-w-[100px]">
                <Button type="submit" :disabled="actionLoading">{{ t('common.add') }}</Button>
              </form>
              <p v-else class="text-[13px] text-[var(--text-muted)] mb-3">{{ t('settings.noManagePermission') }}</p>

              <div class="w-full overflow-x-auto rounded-md border border-[var(--border)]">
                <table class="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('settings.adminTable.account') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('settings.adminTable.level') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('settings.adminTable.source') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('settings.adminTable.status') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('settings.adminTable.updated') }}</th>
                      <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)]">{{ t('settings.adminTable.actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="rule in adminUserRules" :key="rule.id" class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                      <td class="px-3 py-2">{{ adminRuleIdentity(rule) }}</td>
                      <td class="px-3 py-2"><Badge variant="secondary">{{ adminRuleRoleLabel(rule) }}</Badge></td>
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ adminRuleSource(rule) }}</td>
                      <td class="px-3 py-2" :class="rule.enabled ? 'text-emerald-600' : 'text-red-500'">{{ rule.enabled ? t('settings.statusEnabled') : t('settings.statusDisabled') }}</td>
                      <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(rule.updatedAt) }}</td>
                      <td class="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          :disabled="!canManageAdminUsers || rule.source !== 'database' || adminRuleActionId === rule.id"
                          @click="setAdminRuleEnabled(rule, !rule.enabled)"
                        >
                          {{ rule.enabled ? t('common.disable') : t('common.enable') }}
                        </Button>
                      </td>
                    </tr>
                    <tr v-if="!adminUserRules.length">
                      <td colspan="6" class="text-center text-[var(--text-muted)] py-6 px-3">{{ t('settings.noRules') }}</td>
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
