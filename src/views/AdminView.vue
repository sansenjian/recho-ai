<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { apiUrl } from '../lib/api-base'
import { publicClientErrorMessage } from '../lib/safe-error'
import { getAuthAccessToken, useAuthSession } from '../composables/useAuthSession'

interface AdminUser {
  userId: string
  email: string | null
  balance: number
  totalRedeemed: number
  totalSpent: number
  createdAt: string | null
  updatedAt: string | null
  lastSignInAt: string | null
}

interface AdminCode {
  id: string
  code?: string
  credits: number
  maxRedemptions: number
  redeemedCount: number
  expiresAt: string | null
  disabledAt: string | null
  note: string | null
  createdAt: string | null
}

interface AdminCodeRedemption {
  id: string
  userId: string
  email: string | null
  credits: number
  redeemedAt: string | null
  transactionId: string | null
  balanceAfter: number | null
}

interface AdminTransaction {
  id: string
  amount: number
  balance_after: number
  reason: string
  metadata?: Record<string, unknown> | null
  created_at: string | null
}

interface AdminLedgerEntry {
  id: string
  userId: string
  email: string | null
  amount: number
  balanceAfter: number
  reason: string
  note: string | null
  generationId: string | null
  redemptionId: string | null
  relatedTransactionId: string | null
  details: {
    count: number | null
    creditCostPerImage: number | null
    creditCost: number | null
    size: string | null
    aspectRatio: string | null
    resolution: string | null
    quality: string | null
    referenceCount: number | null
    refundReason: string | null
  }
  createdAt: string | null
}

interface AdminImageItem {
  id: string
  userId: string | null
  email: string | null
  prompt: string
  previewUrl: string | null
  thumbnailUrl: string | null
  visibility: 'public' | 'private'
  fundingSource: string | null
  creditCost: number
  size: string | null
  aspectRatio: string | null
  resolution: string | null
  quality: string | null
  generatedAt: string | null
}

interface AdminImageAttemptItem {
  id: string
  generationId: string | null
  userId: string | null
  email: string | null
  status: 'succeeded' | 'failed'
  latencyMs: number | null
  errorType: string | null
  errorCode: string | null
  errorMessage: string | null
  httpStatus: number | null
  createdAt: string | null
}

interface AdminImageAttemptOverview {
  total: number
  succeeded: number
  failed: number
  failureRate: number
  averageLatencyMs: number | null
  byErrorType: Array<{
    errorType: string
    count: number
  }>
}

interface AdminSystemTableStatus {
  key: string
  label: string
  status: 'ok' | 'missing' | 'restricted' | 'error' | 'unavailable'
  count: number | null
  message: string
}

interface AdminSystemStatus {
  generatedAt: string
  status: 'ok' | 'warning' | 'error'
  config: {
    supabase: {
      publicConfigured: boolean
      adminConfigured: boolean
      imageBucketConfigured: boolean
    }
    imageGeneration: {
      apiKeyConfigured: boolean
      creditCostPerImage: number
      analyticsEnabled: boolean
    }
    adminUsers: {
      configured: boolean
      userIdCount: number
      emailCount: number
      databaseCount: number
      envUserIdCount: number
      envEmailCount: number
      tableAvailable: boolean
    }
  }
  data: {
    tables: AdminSystemTableStatus[]
  }
  warnings: string[]
}

interface AdminOverview {
  users: {
    withCreditRows: number
    totalBalance: number
    totalRedeemed: number
    totalSpent: number
  }
  codes: {
    total: number
    active: number
    disabled: number
    expired: number
    exhausted: number
    totalIssuedCredits: number
    totalRedeemedCredits: number
  }
  transactions: {
    last7Days: {
      totalCount: number
      redeemedCredits: number
      spentCredits: number
      refundedCredits: number
      adminAdjustedCredits: number
    }
    byReason: Array<{
      reason: string
      count: number
      amount: number
    }>
  }
  settings: {
    imageCreditCostPerImage: number
  }
  generatedAt: string
}

interface AdminAppSettings {
  imageCreditCostPerImage: number
  imageAnalyticsEnabled: boolean
  imageResponsesModel: string
  imageResponsesImageModel: string
  imageEventsEnabled: boolean
  canvasContextEnabled: boolean
}

interface AdminUserRule {
  id: string
  userId: string | null
  email: string | null
  enabled: boolean
  note: string | null
  source: 'database' | 'env'
  createdAt: string | null
  updatedAt: string | null
}

interface AdminAccessSummary {
  configured: boolean
  userIdCount: number
  emailCount: number
  databaseCount: number
  envUserIdCount: number
  envEmailCount: number
  tableAvailable: boolean
}

const {
  user,
  userEmail,
  isAuthReady,
  initAuth,
} = useAuthSession()

const adminChecked = ref(false)
const isAdmin = ref(false)
const loading = ref(false)
const overviewLoading = ref(false)
const systemLoading = ref(false)
const settingsLoading = ref(false)
const settingsSaving = ref(false)
const ledgerLoading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')

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
const adminUserRules = ref<AdminUserRule[]>([])
const adminAccess = ref<AdminAccessSummary | null>(null)
const selectedCode = ref<AdminCode | null>(null)
const codeRedemptions = ref<AdminCodeRedemption[]>([])

const userQuery = ref('')
const ledgerReason = ref('')
const imageVisibilityFilter = ref('')
const imageFundingFilter = ref('')
const imageUserFilter = ref('')
const imageQuery = ref('')
const imagesLoading = ref(false)
const imageActionId = ref<string | null>(null)
const attemptStatusFilter = ref('')
const attemptsLoading = ref(false)
const codeRedemptionsLoading = ref(false)
const adminRuleActionId = ref<string | null>(null)
const adjustAmount = ref(10)
const adjustNote = ref('')

const settingsForm = ref<AdminAppSettings>({
  imageCreditCostPerImage: 1,
  imageAnalyticsEnabled: false,
  imageResponsesModel: 'gpt-image-2',
  imageResponsesImageModel: 'gpt-image-2',
  imageEventsEnabled: false,
  canvasContextEnabled: false,
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

const selectedUserTitle = computed(() => {
  if (!selectedUser.value) return '未选择用户'
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
  if (!overview.value) return '等待刷新'
  return `更新 ${dateTime(overview.value.generatedAt)}`
})

const systemGeneratedAt = computed(() => {
  if (!systemStatus.value) return '等待检查'
  return `检查 ${dateTime(systemStatus.value.generatedAt)}`
})

const systemStatusLabel = computed(() => {
  if (!systemStatus.value) return '待检查'
  if (systemStatus.value.status === 'ok') return '正常'
  if (systemStatus.value.status === 'warning') return '有告警'
  return '需处理'
})

const adminRuleTotal = computed(() => adminAccess.value
  ? adminAccess.value.databaseCount + adminAccess.value.envUserIdCount + adminAccess.value.envEmailCount
  : adminUserRules.value.length)

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

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function dateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function codeStatus(code: AdminCode) {
  if (code.disabledAt) return '已停用'
  if (code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now()) return '已过期'
  if (code.redeemedCount >= code.maxRedemptions) return '已用完'
  return '可用'
}

function transactionReason(reason: string) {
  if (reason === 'redemption') return '兑换'
  if (reason === 'image_generation') return '生图'
  if (reason === 'refund') return '退款'
  if (reason === 'admin_adjustment') return '后台调整'
  return reason
}

function transactionNote(tx: AdminTransaction) {
  const note = tx.metadata?.note
  return typeof note === 'string' && note.trim() ? note : '-'
}

function ledgerDetails(tx: AdminLedgerEntry) {
  const parts = [
    tx.details.count !== null ? `${tx.details.count} 张` : '',
    tx.details.creditCostPerImage !== null ? `单图 ${tx.details.creditCostPerImage} 额度` : '',
    tx.details.creditCost !== null ? `合计 ${tx.details.creditCost} 额度` : '',
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

function imageVisibilityLabel(visibility: AdminImageItem['visibility']) {
  return visibility === 'private' ? '已隐藏' : '公开'
}

function imageFundingLabel(image: AdminImageItem) {
  return image.fundingSource === 'credit' ? '额度' : '免费'
}

function imagePreviewSrc(image: AdminImageItem) {
  return image.thumbnailUrl || image.previewUrl || ''
}

function imageDetails(image: AdminImageItem) {
  const parts = [
    image.quality ? `质量 ${image.quality}` : '',
    image.resolution ? `分辨率 ${image.resolution}` : '',
    image.size ? `尺寸 ${image.size}` : '',
    image.aspectRatio ? `比例 ${image.aspectRatio}` : '',
    image.creditCost > 0 ? `${image.creditCost} 额度` : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '-'
}

function attemptStatusLabel(status: AdminImageAttemptItem['status']) {
  return status === 'succeeded' ? '成功' : '失败'
}

function latencyLabel(value: number | null) {
  if (value === null) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`
  return `${value}ms`
}

function attemptErrorSummary(attempt: AdminImageAttemptItem) {
  const parts = [
    attempt.errorType || '',
    attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : '',
    attempt.errorCode || '',
    attempt.errorMessage || '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '-'
}

function tableStatusLabel(status: AdminSystemTableStatus['status']) {
  if (status === 'ok') return '正常'
  if (status === 'missing') return '缺失'
  if (status === 'restricted') return '受限'
  if (status === 'unavailable') return '未配置'
  return '异常'
}

function syncSettingsForm(settings: AdminAppSettings) {
  appSettings.value = settings
  settingsForm.value = { ...settings }
}

function adminRuleIdentity(rule: AdminUserRule) {
  return rule.email || (rule.userId ? shortId(rule.userId) : '-')
}

function adminRuleSource(rule: AdminUserRule) {
  return rule.source === 'env' ? '环境变量' : '数据库'
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
    await apiJson<{ admin: boolean }>('/api/admin/credits/me')
    isAdmin.value = true
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
    }>('/api/admin/settings')
    syncSettingsForm(data.settings)
    adminUserRules.value = data.adminUsers
    adminAccess.value = data.adminAccess
  } catch (error) {
    setError(error)
  } finally {
    settingsLoading.value = false
  }
}

async function saveSettings() {
  settingsSaving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await apiJson<{ settings: AdminAppSettings }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        imageCreditCostPerImage: Number(settingsForm.value.imageCreditCostPerImage),
        imageAnalyticsEnabled: Boolean(settingsForm.value.imageAnalyticsEnabled),
        imageResponsesModel: settingsForm.value.imageResponsesModel,
        imageResponsesImageModel: settingsForm.value.imageResponsesImageModel,
        imageEventsEnabled: Boolean(settingsForm.value.imageEventsEnabled),
        canvasContextEnabled: Boolean(settingsForm.value.canvasContextEnabled),
      }),
    })
    syncSettingsForm(data.settings)
    noticeMessage.value = '配置已保存'
    await Promise.all([refreshOverview(), refreshSystem()])
  } catch (error) {
    setError(error)
  } finally {
    settingsSaving.value = false
  }
}

async function refreshLedger() {
  ledgerLoading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams()
    query.set('limit', '50')
    if (ledgerReason.value) query.set('reason', ledgerReason.value)
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
  } catch (error) {
    setError(error)
  } finally {
    imagesLoading.value = false
  }
}

async function refreshAttempts() {
  attemptsLoading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams()
    query.set('limit', '40')
    if (attemptStatusFilter.value) query.set('status', attemptStatusFilter.value)
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

async function setImageVisibility(image: AdminImageItem, visibility: AdminImageItem['visibility']) {
  if (visibility === 'public' && image.fundingSource === 'credit') return
  if (visibility === 'private' && !window.confirm('确认从作品广场隐藏这张图片？')) return

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
    const nextImages = adminImages.value.map(item => item.id === data.image.id ? data.image : item)
    adminImages.value = imageVisibilityFilter.value
      ? nextImages.filter(item => item.visibility === imageVisibilityFilter.value)
      : nextImages
    noticeMessage.value = visibility === 'private' ? '作品已隐藏' : '作品已恢复公开'
  } catch (error) {
    setError(error)
  } finally {
    imageActionId.value = null
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
    noticeMessage.value = '额度已调整'
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
    noticeMessage.value = `已生成 ${data.codes.length} 个兑换码`
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
  if (disabled && !window.confirm('确认停用这个兑换码？')) return
  actionLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ code: AdminCode }>(`/api/admin/credits/codes/${encodeURIComponent(code.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    })
    codes.value = codes.value.map(item => item.id === data.code.id ? data.code : item)
    if (selectedCode.value?.id === data.code.id) selectedCode.value = data.code
    noticeMessage.value = disabled ? '兑换码已停用' : '兑换码已恢复'
    await refreshOverview()
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function createAdminRule() {
  if (!adminUserForm.value.userId.trim() && !adminUserForm.value.email.trim()) {
    errorMessage.value = '请输入用户 ID 或邮箱。'
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
    noticeMessage.value = '管理员规则已添加'
    await refreshSystem()
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function setAdminRuleEnabled(rule: AdminUserRule, enabled: boolean) {
  if (rule.source !== 'database') return
  if (!enabled && !window.confirm('确认停用这个后台管理员规则？')) return

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
    noticeMessage.value = enabled ? '管理员规则已启用' : '管理员规则已停用'
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
    noticeMessage.value = 'CSV 已复制'
  } catch (error) {
    setError(error, '复制失败，请手动选择内容。')
  }
}

function downloadCreatedCsv() {
  if (!createdCodes.value.length) return
  const blob = new Blob([`${createdCsv.value}\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `recho-credit-codes-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  link.click()
  URL.revokeObjectURL(url)
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
      refreshAttempts(),
      refreshUsers(),
      refreshCodes(),
    ])
  }
})
</script>

<template>
  <main class="admin-page">
    <header class="admin-header">
      <div>
        <span class="admin-eyebrow">Recho Admin</span>
        <h1>额度后台</h1>
      </div>
      <nav class="admin-nav" aria-label="后台导航">
        <RouterLink to="/image">画布</RouterLink>
        <RouterLink to="/works">作品</RouterLink>
      </nav>
    </header>

    <section v-if="!isAuthReady || !adminChecked" class="admin-state">
      <span class="spinner" />
      <strong>正在检查权限</strong>
    </section>

    <section v-else-if="!user" class="admin-state">
      <strong>请先登录</strong>
      <RouterLink to="/image">返回登录</RouterLink>
    </section>

    <section v-else-if="!isAdmin" class="admin-state">
      <strong>{{ errorMessage || '当前账号没有后台权限。' }}</strong>
      <span>{{ userEmail }}</span>
    </section>

    <template v-else>
      <div class="admin-feedback" aria-live="polite">
        <p v-if="errorMessage" class="admin-message error">{{ errorMessage }}</p>
        <p v-if="noticeMessage" class="admin-message success">{{ noticeMessage }}</p>
      </div>

      <section class="overview-panel" aria-label="额度总览">
        <div class="overview-header">
          <div>
            <span>总览</span>
            <strong>{{ overviewGeneratedAt }}</strong>
          </div>
          <button type="button" :disabled="overviewLoading" @click="refreshOverview">刷新</button>
        </div>
        <div class="overview-grid">
          <div>
            <span>总余额</span>
            <strong>{{ overview?.users.totalBalance ?? 0 }}</strong>
          </div>
          <div>
            <span>累计兑换</span>
            <strong>{{ overview?.users.totalRedeemed ?? 0 }}</strong>
          </div>
          <div>
            <span>累计消耗</span>
            <strong>{{ overview?.users.totalSpent ?? 0 }}</strong>
          </div>
          <div>
            <span>单图成本</span>
            <strong>{{ overview?.settings.imageCreditCostPerImage ?? 1 }}</strong>
          </div>
          <div>
            <span>兑换码可用</span>
            <strong>{{ overviewCodeHealth }}</strong>
          </div>
          <div>
            <span>已兑换码额度</span>
            <strong>{{ overview?.codes.totalRedeemedCredits ?? 0 }}</strong>
          </div>
          <div>
            <span>7 天流水</span>
            <strong>{{ overview?.transactions.last7Days.totalCount ?? 0 }}</strong>
          </div>
          <div>
            <span>7 天消耗</span>
            <strong>{{ overview?.transactions.last7Days.spentCredits ?? 0 }}</strong>
          </div>
          <div>
            <span>7 天净变化</span>
            <strong :class="overviewNetChange >= 0 ? 'positive' : 'negative'">{{ overviewNetChange > 0 ? '+' : '' }}{{ overviewNetChange }}</strong>
          </div>
        </div>
      </section>

      <section class="admin-panel system-panel" aria-label="系统状态">
        <div class="panel-header system-header">
          <div>
            <span>系统状态</span>
            <strong>{{ systemGeneratedAt }}</strong>
          </div>
          <div class="system-controls">
            <span :class="['system-status-pill', systemStatus?.status || 'warning']">{{ systemStatusLabel }}</span>
            <button type="button" :disabled="systemLoading" @click="refreshSystem">刷新</button>
          </div>
        </div>
        <div class="system-grid">
          <div>
            <span>Supabase 后端</span>
            <strong :class="systemStatus ? (systemStatus.config.supabase.adminConfigured ? 'positive' : 'negative') : ''">
              {{ systemStatus ? (systemStatus.config.supabase.adminConfigured ? '就绪' : '未就绪') : '-' }}
            </strong>
          </div>
          <div>
            <span>生图服务</span>
            <strong :class="systemStatus ? (systemStatus.config.imageGeneration.apiKeyConfigured ? 'positive' : 'negative') : ''">
              {{ systemStatus ? (systemStatus.config.imageGeneration.apiKeyConfigured ? '就绪' : '未就绪') : '-' }}
            </strong>
          </div>
          <div>
            <span>管理员规则</span>
            <strong>{{ systemStatus ? systemStatus.config.adminUsers.databaseCount + systemStatus.config.adminUsers.envUserIdCount + systemStatus.config.adminUsers.envEmailCount : '-' }}</strong>
          </div>
          <div>
            <span>生图监控</span>
            <strong>{{ systemStatus ? (systemStatus.config.imageGeneration.analyticsEnabled ? '开启' : '关闭') : '-' }}</strong>
          </div>
          <div>
            <span>单图成本</span>
            <strong>{{ systemStatus?.config.imageGeneration.creditCostPerImage ?? 1 }}</strong>
          </div>
        </div>
        <div class="system-warnings">
          <span v-for="warning in systemStatus?.warnings || []" :key="warning">{{ warning }}</span>
          <span v-if="systemStatus && !systemStatus.warnings.length">无告警</span>
          <span v-else-if="!systemStatus">等待检查</span>
        </div>
        <div class="table-wrap system-table-wrap">
          <table class="system-table">
            <thead>
              <tr>
                <th>模块</th>
                <th>状态</th>
                <th>记录数</th>
                <th>信息</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="table in systemStatus?.data.tables || []" :key="table.key">
                <td>{{ table.label }}</td>
                <td :class="table.status === 'ok' ? 'positive' : 'negative'">{{ tableStatusLabel(table.status) }}</td>
                <td>{{ table.count ?? '-' }}</td>
                <td>{{ table.message }}</td>
              </tr>
              <tr v-if="!(systemStatus?.data.tables || []).length">
                <td colspan="4">暂无检查结果</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="admin-grid settings-grid" aria-label="运行时配置">
        <div class="admin-panel settings-panel">
          <div class="panel-header">
            <div>
              <span>运行时配置</span>
              <strong>{{ appSettings ? '已加载' : '等待加载' }}</strong>
            </div>
            <button type="button" :disabled="settingsLoading" @click="refreshSettings">刷新</button>
          </div>

          <form class="settings-form" @submit.prevent="saveSettings">
            <label>
              <span>单图额度</span>
              <input v-model.number="settingsForm.imageCreditCostPerImage" type="number" min="1" step="1">
            </label>
            <label>
              <span>响应模型</span>
              <input v-model.trim="settingsForm.imageResponsesModel" type="text">
            </label>
            <label>
              <span>生图模型</span>
              <input v-model.trim="settingsForm.imageResponsesImageModel" type="text">
            </label>
            <label class="check-row">
              <input v-model="settingsForm.imageAnalyticsEnabled" type="checkbox">
              <span>分析记录</span>
            </label>
            <label class="check-row">
              <input v-model="settingsForm.imageEventsEnabled" type="checkbox">
              <span>前端事件</span>
            </label>
            <label class="check-row">
              <input v-model="settingsForm.canvasContextEnabled" type="checkbox">
              <span>画布上下文</span>
            </label>
            <button type="submit" :disabled="settingsSaving">{{ settingsSaving ? '保存中' : '保存配置' }}</button>
          </form>
        </div>

        <div class="admin-panel admin-users-panel">
          <div class="panel-header">
            <div>
              <span>后台管理员</span>
              <strong>{{ adminRuleTotal }}</strong>
            </div>
            <button type="button" :disabled="settingsLoading" @click="refreshSettings">刷新</button>
          </div>

          <form class="admin-user-form" @submit.prevent="createAdminRule">
            <label>
              <span>用户 ID</span>
              <input v-model.trim="adminUserForm.userId" type="text">
            </label>
            <label>
              <span>邮箱</span>
              <input v-model.trim="adminUserForm.email" type="email">
            </label>
            <label class="wide">
              <span>备注</span>
              <input v-model.trim="adminUserForm.note" type="text">
            </label>
            <button type="submit" :disabled="actionLoading">添加</button>
          </form>

          <div class="table-wrap">
            <table class="admin-rule-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rule in adminUserRules" :key="rule.id">
                  <td>{{ adminRuleIdentity(rule) }}</td>
                  <td>{{ adminRuleSource(rule) }}</td>
                  <td :class="rule.enabled ? 'positive' : 'negative'">{{ rule.enabled ? '启用' : '停用' }}</td>
                  <td>{{ dateTime(rule.updatedAt) }}</td>
                  <td>
                    <button
                      type="button"
                      class="table-action"
                      :disabled="rule.source !== 'database' || adminRuleActionId === rule.id"
                      @click="setAdminRuleEnabled(rule, !rule.enabled)"
                    >
                      {{ rule.enabled ? '停用' : '启用' }}
                    </button>
                  </td>
                </tr>
                <tr v-if="!adminUserRules.length">
                  <td colspan="5">暂无管理员规则</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="admin-panel ledger-panel" aria-label="最近额度流水">
        <div class="panel-header ledger-header">
          <div>
            <span>最近流水</span>
            <strong>{{ ledgerTransactions.length }}</strong>
          </div>
          <div class="ledger-controls">
            <select v-model="ledgerReason" :disabled="ledgerLoading" @change="refreshLedger">
              <option value="">全部类型</option>
              <option value="redemption">兑换</option>
              <option value="image_generation">生图</option>
              <option value="refund">退款</option>
              <option value="admin_adjustment">后台调整</option>
            </select>
            <button type="button" :disabled="ledgerLoading" @click="refreshLedger">刷新</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>类型</th>
                <th>变动</th>
                <th>余额</th>
                <th>详情</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tx in ledgerTransactions" :key="tx.id">
                <td>{{ dateTime(tx.createdAt) }}</td>
                <td>{{ tx.email || shortId(tx.userId) }}</td>
                <td>{{ transactionReason(tx.reason) }}</td>
                <td :class="tx.amount > 0 ? 'positive' : 'negative'">{{ tx.amount > 0 ? '+' : '' }}{{ tx.amount }}</td>
                <td>{{ tx.balanceAfter }}</td>
                <td>{{ ledgerDetails(tx) }}</td>
                <td>{{ tx.note || '-' }}</td>
              </tr>
              <tr v-if="!ledgerTransactions.length">
                <td colspan="7">暂无流水</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel images-panel" aria-label="作品管理">
        <div class="panel-header image-header">
          <div>
            <span>作品管理</span>
            <strong>{{ adminImages.length }}</strong>
          </div>
          <form class="image-controls" @submit.prevent="refreshImages">
            <select v-model="imageVisibilityFilter" :disabled="imagesLoading" @change="refreshImages">
              <option value="">全部状态</option>
              <option value="public">公开</option>
              <option value="private">已隐藏</option>
            </select>
            <select v-model="imageFundingFilter" :disabled="imagesLoading" @change="refreshImages">
              <option value="">全部来源</option>
              <option value="free">免费</option>
              <option value="credit">额度</option>
            </select>
            <input v-model.trim="imageUserFilter" type="search" placeholder="用户 ID" :disabled="imagesLoading">
            <input v-model.trim="imageQuery" type="search" placeholder="提示词" :disabled="imagesLoading">
            <button type="submit" :disabled="imagesLoading">筛选</button>
            <button type="button" :disabled="imagesLoading" @click="refreshImages">刷新</button>
          </form>
        </div>
        <div class="table-wrap image-table-wrap">
          <table class="image-table">
            <thead>
              <tr>
                <th>预览</th>
                <th>时间</th>
                <th>用户</th>
                <th>状态</th>
                <th>来源</th>
                <th>参数</th>
                <th>提示词</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="image in adminImages" :key="image.id">
                <td>
                  <img v-if="imagePreviewSrc(image)" class="image-thumb" :src="imagePreviewSrc(image)" alt="">
                  <span v-else class="image-thumb empty">无图</span>
                </td>
                <td>{{ dateTime(image.generatedAt) }}</td>
                <td>{{ image.email || (image.userId ? shortId(image.userId) : '-') }}</td>
                <td>{{ imageVisibilityLabel(image.visibility) }}</td>
                <td>{{ imageFundingLabel(image) }}</td>
                <td>{{ imageDetails(image) }}</td>
                <td class="prompt-cell">{{ image.prompt || '-' }}</td>
                <td>
                  <button
                    v-if="image.visibility === 'public'"
                    type="button"
                    class="table-action"
                    :disabled="imageActionId === image.id"
                    @click="setImageVisibility(image, 'private')"
                  >
                    隐藏
                  </button>
                  <button
                    v-else-if="image.fundingSource !== 'credit'"
                    type="button"
                    class="table-action"
                    :disabled="imageActionId === image.id"
                    @click="setImageVisibility(image, 'public')"
                  >
                    公开
                  </button>
                  <span v-else class="table-muted">私有</span>
                </td>
              </tr>
              <tr v-if="!adminImages.length">
                <td colspan="8">暂无作品</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="admin-panel attempts-panel" aria-label="生图监控">
        <div class="panel-header attempt-header">
          <div>
            <span>生图监控</span>
            <strong>{{ imageAttemptOverview?.total ?? 0 }}</strong>
          </div>
          <div class="attempt-controls">
            <select v-model="attemptStatusFilter" :disabled="attemptsLoading" @change="refreshAttempts">
              <option value="">全部状态</option>
              <option value="succeeded">成功</option>
              <option value="failed">失败</option>
            </select>
            <button type="button" :disabled="attemptsLoading" @click="refreshAttempts">刷新</button>
          </div>
        </div>
        <div class="attempt-metrics">
          <div>
            <span>24h 成功</span>
            <strong>{{ imageAttemptOverview?.succeeded ?? 0 }}</strong>
          </div>
          <div>
            <span>24h 失败</span>
            <strong>{{ imageAttemptOverview?.failed ?? 0 }}</strong>
          </div>
          <div>
            <span>失败率</span>
            <strong>{{ imageAttemptOverview?.failureRate ?? 0 }}%</strong>
          </div>
          <div>
            <span>平均耗时</span>
            <strong>{{ latencyLabel(imageAttemptOverview?.averageLatencyMs ?? null) }}</strong>
          </div>
        </div>
        <div class="attempt-error-list">
          <span
            v-for="item in imageAttemptOverview?.byErrorType || []"
            :key="item.errorType"
          >
            {{ item.errorType }} · {{ item.count }}
          </span>
          <span v-if="!(imageAttemptOverview?.byErrorType || []).length">暂无错误类型</span>
        </div>
        <div class="table-wrap attempt-table-wrap">
          <table class="attempt-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>状态</th>
                <th>耗时</th>
                <th>生成 ID</th>
                <th>错误摘要</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="attempt in imageAttempts" :key="attempt.id">
                <td>{{ dateTime(attempt.createdAt) }}</td>
                <td>{{ attempt.email || (attempt.userId ? shortId(attempt.userId) : '-') }}</td>
                <td :class="attempt.status === 'succeeded' ? 'positive' : 'negative'">{{ attemptStatusLabel(attempt.status) }}</td>
                <td>{{ latencyLabel(attempt.latencyMs) }}</td>
                <td>{{ attempt.generationId ? shortId(attempt.generationId) : '-' }}</td>
                <td class="attempt-error-cell">{{ attemptErrorSummary(attempt) }}</td>
              </tr>
              <tr v-if="!imageAttempts.length">
                <td colspan="6">暂无尝试记录</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="admin-grid">
        <div class="admin-panel users-panel">
          <div class="panel-header">
            <div>
              <span>用户</span>
              <strong>{{ users.length }}</strong>
            </div>
            <button type="button" :disabled="loading" @click="refreshUsers">刷新</button>
          </div>
          <form class="search-row" @submit.prevent="refreshUsers">
            <input v-model.trim="userQuery" type="search" placeholder="邮箱或用户 ID">
            <button type="submit" :disabled="loading">搜索</button>
          </form>
          <div class="user-list">
            <button
              v-for="item in users"
              :key="item.userId"
              type="button"
              class="user-row"
              :class="{ active: selectedUser?.userId === item.userId }"
              @click="selectUser(item)"
            >
              <span>{{ item.email || shortId(item.userId) }}</span>
              <strong>{{ item.balance }}</strong>
            </button>
          </div>
        </div>

        <div class="admin-panel detail-panel">
          <div class="panel-header">
            <div>
              <span>当前用户</span>
              <strong>{{ selectedUserTitle }}</strong>
            </div>
          </div>

          <div v-if="selectedUser" class="metric-grid">
            <div>
              <span>余额</span>
              <strong>{{ selectedUser.balance }}</strong>
            </div>
            <div>
              <span>累计兑换</span>
              <strong>{{ selectedUser.totalRedeemed }}</strong>
            </div>
            <div>
              <span>累计消耗</span>
              <strong>{{ selectedUser.totalSpent }}</strong>
            </div>
            <div>
              <span>更新</span>
              <strong>{{ dateTime(selectedUser.updatedAt) }}</strong>
            </div>
          </div>

          <form class="adjust-form" @submit.prevent="submitAdjustment">
            <label>
              <span>调整额度</span>
              <input v-model.number="adjustAmount" type="number" step="1" placeholder="正数增加，负数扣除">
            </label>
            <label>
              <span>备注</span>
              <input v-model.trim="adjustNote" type="text" placeholder="内部备注">
            </label>
            <button type="submit" :disabled="actionLoading || !selectedUser || !adjustAmount">提交</button>
          </form>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>变动</th>
                  <th>余额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tx in transactions" :key="tx.id">
                  <td>{{ dateTime(tx.created_at) }}</td>
                  <td>{{ transactionReason(tx.reason) }}</td>
                  <td :class="tx.amount > 0 ? 'positive' : 'negative'">{{ tx.amount > 0 ? '+' : '' }}{{ tx.amount }}</td>
                  <td>{{ tx.balance_after }}</td>
                  <td>{{ transactionNote(tx) }}</td>
                </tr>
                <tr v-if="!transactions.length">
                  <td colspan="5">暂无流水</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="admin-grid codes-grid">
        <div class="admin-panel">
          <div class="panel-header">
            <div>
              <span>生成兑换码</span>
              <strong>{{ codeForm.count }} 个</strong>
            </div>
          </div>

          <form class="code-form" @submit.prevent="createCodes">
            <label>
              <span>前缀</span>
              <input v-model.trim="codeForm.prefix" type="text">
            </label>
            <label>
              <span>额度</span>
              <input v-model.number="codeForm.credits" type="number" min="1" step="1">
            </label>
            <label>
              <span>数量</span>
              <input v-model.number="codeForm.count" type="number" min="1" max="100" step="1">
            </label>
            <label>
              <span>可兑换次数</span>
              <input v-model.number="codeForm.maxRedemptions" type="number" min="1" step="1">
            </label>
            <label>
              <span>有效天数</span>
              <input v-model.number="codeForm.days" type="number" min="1" step="1">
            </label>
            <label class="wide">
              <span>备注</span>
              <input v-model.trim="codeForm.note" type="text">
            </label>
            <button type="submit" :disabled="actionLoading">生成</button>
          </form>

          <div v-if="createdCodes.length" class="created-codes">
            <div class="created-actions">
              <strong>本次生成</strong>
              <button type="button" @click="copyCreatedCsv">复制 CSV</button>
              <button type="button" @click="downloadCreatedCsv">下载 CSV</button>
            </div>
            <textarea :value="createdCsv" readonly rows="6" />
          </div>
        </div>

        <div class="admin-panel">
          <div class="panel-header">
            <div>
              <span>兑换码</span>
              <strong>{{ codes.length }}</strong>
            </div>
            <button type="button" :disabled="loading" @click="refreshCodes">刷新</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>创建</th>
                  <th>额度</th>
                  <th>使用</th>
                  <th>状态</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="code in codes" :key="code.id">
                  <td>{{ dateTime(code.createdAt) }}</td>
                  <td>{{ code.credits }}</td>
                  <td>{{ code.redeemedCount }} / {{ code.maxRedemptions }}</td>
                  <td>{{ codeStatus(code) }}</td>
                  <td>{{ code.note || '-' }}</td>
                  <td>
                    <div class="code-actions">
                      <button
                        type="button"
                        class="table-action"
                        :disabled="codeRedemptionsLoading && selectedCode?.id === code.id"
                        @click="viewCodeRedemptions(code)"
                      >
                        明细
                      </button>
                    <button
                      type="button"
                      class="table-action"
                      :disabled="actionLoading"
                      @click="setCodeDisabled(code, !code.disabledAt)"
                    >
                      {{ code.disabledAt ? '恢复' : '停用' }}
                    </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="!codes.length">
                  <td colspan="6">暂无兑换码</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="selectedCode" class="code-redemptions">
            <div class="created-actions">
              <strong>兑换明细</strong>
              <span>{{ selectedCode.redeemedCount }} / {{ selectedCode.maxRedemptions }}</span>
              <button type="button" :disabled="codeRedemptionsLoading" @click="viewCodeRedemptions(selectedCode)">刷新</button>
            </div>
            <div class="table-wrap">
              <table class="code-redemption-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>用户</th>
                    <th>额度</th>
                    <th>余额</th>
                    <th>流水</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="redemption in codeRedemptions" :key="redemption.id">
                    <td>{{ dateTime(redemption.redeemedAt) }}</td>
                    <td>{{ redemption.email || shortId(redemption.userId) }}</td>
                    <td>{{ redemption.credits }}</td>
                    <td>{{ redemption.balanceAfter ?? '-' }}</td>
                    <td>{{ redemption.transactionId ? shortId(redemption.transactionId) : '-' }}</td>
                  </tr>
                  <tr v-if="!codeRedemptions.length">
                    <td colspan="5">{{ codeRedemptionsLoading ? '正在加载' : '暂无兑换记录' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.admin-page {
  min-height: 100vh;
  padding: 22px;
  background: var(--bg);
  color: var(--text-primary);
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  max-width: 1360px;
  margin: 0 auto 18px;
}

.admin-eyebrow,
.overview-header span,
.overview-grid span,
.panel-header span,
.metric-grid span,
.adjust-form span,
.code-form span,
.settings-form span,
.admin-user-form span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.admin-header h1 {
  font-size: 28px;
  line-height: 1.2;
}

.admin-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-nav a,
.admin-state a,
.overview-header button,
.ledger-controls button,
.image-controls button,
.attempt-controls button,
.panel-header button,
.search-row button,
.adjust-form button,
.code-form button,
.settings-form button,
.admin-user-form button,
.created-actions button,
.table-action {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

.admin-nav a:hover,
.admin-state a:hover,
.overview-header button:hover:not(:disabled),
.ledger-controls button:hover:not(:disabled),
.image-controls button:hover:not(:disabled),
.attempt-controls button:hover:not(:disabled),
.panel-header button:hover:not(:disabled),
.search-row button:hover:not(:disabled),
.adjust-form button:hover:not(:disabled),
.code-form button:hover:not(:disabled),
.settings-form button:hover:not(:disabled),
.admin-user-form button:hover:not(:disabled),
.created-actions button:hover,
.table-action:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.admin-state {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 360px;
  max-width: 720px;
  margin: 0 auto;
  padding: 32px;
  text-align: center;
}

.spinner {
  width: 22px;
  height: 22px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.admin-feedback {
  max-width: 1360px;
  min-height: 34px;
  margin: 0 auto 10px;
}

.admin-message {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 800;
}

.admin-message.error {
  background: rgba(220, 38, 38, 0.1);
  color: var(--danger);
}

.admin-message.success {
  background: var(--accent-soft);
  color: var(--accent);
}

.overview-panel {
  max-width: 1360px;
  margin: 0 auto 14px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.overview-header strong {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 13px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: 10px;
}

.overview-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.overview-grid strong {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.admin-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 14px;
  max-width: 1360px;
  margin: 0 auto 14px;
}

.codes-grid {
  grid-template-columns: minmax(360px, 0.8fr) minmax(0, 1.2fr);
}

.settings-grid {
  grid-template-columns: minmax(360px, 0.95fr) minmax(0, 1.05fr);
}

.admin-panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.ledger-panel,
.images-panel,
.system-panel,
.attempts-panel {
  max-width: 1360px;
  margin: 0 auto 14px;
}

.ledger-header,
.image-header,
.system-header,
.attempt-header {
  align-items: flex-start;
}

.ledger-controls,
.image-controls,
.system-controls,
.attempt-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.image-controls input {
  width: 180px;
  min-width: 140px;
}

.system-status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.system-status-pill.ok {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.1);
  color: var(--accent);
}

.system-status-pill.warning {
  border-color: rgba(245, 158, 11, 0.32);
  background: rgba(245, 158, 11, 0.1);
  color: #b45309;
}

.system-status-pill.error {
  border-color: rgba(239, 68, 68, 0.32);
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

.panel-header,
.created-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.panel-header strong {
  display: block;
  margin-top: 2px;
  font-size: 18px;
}

.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 10px;
}

input,
select,
textarea {
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-primary);
  padding: 7px 9px;
}

select {
  min-width: 130px;
  cursor: pointer;
}

textarea {
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
}

.user-list {
  display: grid;
  gap: 6px;
  max-height: 470px;
  overflow: auto;
}

.user-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
  color: var(--text-primary);
  text-align: left;
}

.user-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-row.active {
  border-color: rgba(37, 99, 235, 0.42);
  background: rgba(37, 99, 235, 0.08);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.metric-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.metric-grid strong {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.adjust-form,
.code-form,
.settings-form,
.admin-user-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  align-items: end;
  gap: 10px;
  margin-bottom: 14px;
}

.code-form {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.settings-form {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.admin-user-form {
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
}

.code-form .wide,
.admin-user-form .wide {
  grid-column: span 2;
}

.code-form button,
.settings-form button,
.admin-user-form button {
  align-self: end;
}

.settings-form .check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.settings-form .check-row input {
  width: auto;
  min-height: auto;
}

.settings-form .check-row span {
  color: var(--text-primary);
}

.table-wrap {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.system-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.system-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.system-grid span,
.system-warnings span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.system-grid strong {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.system-warnings {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.system-warnings span {
  min-height: 26px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.system-table {
  min-width: 620px;
}

.admin-rule-table {
  min-width: 680px;
}

.image-table-wrap {
  max-height: 560px;
}

.image-table {
  min-width: 1080px;
}

.image-thumb {
  display: block;
  width: 64px;
  height: 64px;
  object-fit: cover;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.image-thumb.empty {
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.prompt-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-muted {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.attempt-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.attempt-metrics div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.attempt-metrics span,
.attempt-error-list span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.attempt-metrics strong {
  display: block;
  margin-top: 3px;
  font-size: 18px;
}

.attempt-error-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.attempt-error-list span {
  min-height: 26px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.attempt-table {
  min-width: 920px;
}

.attempt-error-cell {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

th {
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.positive {
  color: var(--accent);
  font-weight: 800;
}

.negative {
  color: var(--danger);
  font-weight: 800;
}

.created-codes {
  margin-top: 12px;
}

.code-redemptions {
  margin-top: 12px;
}

.code-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.code-redemption-table {
  min-width: 620px;
}

.created-actions {
  justify-content: flex-start;
}

@media (max-width: 980px) {
  .admin-grid,
  .codes-grid,
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .overview-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .attempt-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .system-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .admin-page {
    padding: 14px;
  }

  .admin-header,
  .adjust-form,
  .code-form,
  .settings-form,
  .admin-user-form {
    grid-template-columns: 1fr;
  }

  .admin-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .attempt-metrics {
    grid-template-columns: 1fr;
  }

  .code-form .wide,
  .admin-user-form .wide {
    grid-column: auto;
  }
}
</style>
