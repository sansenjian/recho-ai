<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2 } from '@lucide/vue'
import { adminApiJson } from '../../composables/useAdminApi'
import { publicClientErrorMessage } from '../../lib/safe-error'
import type {
  AdminAccessSummary,
  AdminAppSettings,
  AdminImageModelCreditCost,
  AdminProviderSetting,
  AdminProviderModel,
  AdminProviderSettingsState,
  AdminRole,
  AdminUserRule,
  ImageProviderCompatibilityMode,
} from '../../types/admin'
import { dateTime, shortId } from '../../utils/admin-format'
import { normalizeCreditBalance } from '../../utils/credit-format'

const emit = defineEmits<{
  roleChanged: [role: AdminRole]
  dataChanged: [source: 'settings']
}>()

const props = withDefaults(defineProps<{
  section?: 'all' | 'runtime' | 'providers'
}>(), { section: 'all' })

const { t } = useI18n()
const settingsLoading = ref(false)
const settingsLoaded = ref(false)
const settingsSaving = ref(false)
const actionLoading = ref(false)
const providerActionId = ref<string | null>(null)
const adminRuleActionId = ref<string | null>(null)
const errorMessage = ref('')
const noticeMessage = ref('')
const appSettings = ref<AdminAppSettings | null>(null)
const providerSettings = ref<AdminProviderSettingsState | null>(null)
const adminUserRules = ref<AdminUserRule[]>([])
const adminAccess = ref<AdminAccessSummary | null>(null)
const currentAdminRole = ref<AdminRole>('operator')

const settingsForm = ref<AdminAppSettings>({
  imageCreditCostPerImage: 1,
  imageModelCreditCosts: [],
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
  models: [] as string[],
  modelCatalog: [] as AdminProviderModel[],
  imageModel: 'gpt-image-2',
  editModel: 'gpt-image-2',
  imageCompatibilityMode: 'auto' as ImageProviderCompatibilityMode,
  timeoutMs: 360000,
  retryCount: 3,
  supportsWebpReferences: true,
  notes: '',
})
const adminUserForm = ref({ userId: '', email: '', note: '' })

const settingsPricePerImage = computed(() => {
  const cost = normalizeCreditBalance(settingsForm.value.imageCreditCostPerImage)
  return cost !== null ? Math.max(0.01, cost) : 1
})
const settingsPricePreview = computed(() => [1, 4, 8].map(count => ({
  label: `${count} 张`,
  value: settingsPricePerImage.value * count,
})))
const providerRows = computed(() => providerSettings.value?.providers || [])
const imageProviderRows = computed(() => providerRows.value.filter(provider => provider.kind === 'image'))
const chatProviderRows = computed(() => providerRows.value.filter(provider => provider.kind === 'chat'))

/**
 * 可能被计费的模型清单，用于「按模型定价」的取值候选。
 *
 * 为什么要带上 editModel：带参考图的请求走 /images/edits，扣费模型是 editModel，
 * 它与默认生图模型是两条独立的计费路径，必须能分别定价。
 */
const billableImageModelIds = computed(() => {
  const ids: string[] = []
  const push = (value?: string | null) => {
    const id = (value || '').trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  for (const provider of imageProviderRows.value) {
    for (const model of providerModelCatalogRows(provider)) {
      if (model.enabled) push(model.id)
    }
    push(provider.editModel)
    push(provider.imageModel)
  }
  push(settingsForm.value.imageResponsesImageModel)
  return ids
})

/** 某模型的生效单价：命中覆盖价用覆盖价，否则回退兜底价。 */
function effectiveModelPrice(cost: number | null | undefined) {
  const value = normalizeCreditBalance(cost ?? 0)
  return value !== null && value >= 0.01 ? value : settingsPricePerImage.value
}

function addModelPriceRow(modelId = '') {
  const rows = settingsForm.value.imageModelCreditCosts
  if (!modelId && !rows.length) {
    // 首次展开时把所有已配置的模型一次补齐，管理员只需改价，不必逐个手打 id。
    fillModelPriceRows()
    return
  }
  rows.push({ id: modelId, cost: settingsPricePerImage.value })
}

function removeModelPriceRow(index: number) {
  settingsForm.value.imageModelCreditCosts.splice(index, 1)
}

/** 把候选模型里尚未出现在表中的项补进来，价格先取当前兜底价。 */
function fillModelPriceRows() {
  const rows = settingsForm.value.imageModelCreditCosts
  const existing = new Set(rows.map(row => row.id.trim()).filter(Boolean))
  for (const id of billableImageModelIds.value) {
    if (existing.has(id)) continue
    rows.push({ id, cost: settingsPricePerImage.value })
    existing.add(id)
  }
  if (!rows.length) rows.push({ id: '', cost: settingsPricePerImage.value })
}

/**
 * 提交前清洗覆盖价行：trim 模型 id、价格保留两位小数；
 * 空 id / 重复 id / 价格非正数的行直接丢弃。
 *
 * 与后端 normalizeImageModelCreditCosts 的语义一致（丢弃而非钳成默认价），
 * 避免一次手滑输入静默改动某个模型的真实计费。
 */
function normalizeModelPriceRows(rows: AdminImageModelCreditCost[]): AdminImageModelCreditCost[] {
  const seen = new Set<string>()
  const result: AdminImageModelCreditCost[] = []
  for (const row of rows) {
    const id = row.id.trim()
    if (!id || seen.has(id)) continue
    const cost = normalizeCreditBalance(row.cost)
    if (cost === null || cost < 0.01) continue
    seen.add(id)
    result.push({ id, cost: Math.round(cost * 100) / 100 })
  }
  return result
}

const editingProvider = computed(() => providerForm.value.id
  ? providerRows.value.find(provider => provider.id === providerForm.value.id) || null
  : null)
const adminRuleTotal = computed(() => adminAccess.value
  ? adminAccess.value.databaseCount + adminAccess.value.envUserIdCount + adminAccess.value.envEmailCount
  : adminUserRules.value.length)
const canManageAdminUsers = computed(() => currentAdminRole.value === 'senior')

function setError(error: unknown, fallback = '后台操作失败，请稍后重试。') {
  errorMessage.value = publicClientErrorMessage(error, fallback)
}

function syncSettingsForm(settings: AdminAppSettings) {
  appSettings.value = settings
  settingsForm.value = {
    ...settings,
    // 覆盖价行要能被就地编辑，必须与接口返回的对象断开引用，
    // 否则未保存的改动会污染 appSettings 里的快照。
    imageModelCreditCosts: (settings.imageModelCreditCosts || []).map(row => ({ ...row })),
  }
  settingsLoaded.value = true
}

function resetProviderForm(kind: 'chat' | 'image' = 'image') {
  const defaultModel = kind === 'chat' ? 'gpt-4o-mini' : 'gpt-image-2'
  providerForm.value = {
    id: '', kind, name: '', baseUrl: '', apiKey: '', clearApiKey: false, enabled: true,
    priority: 100,
    defaultModel: kind === 'chat' ? defaultModel : '',
    models: [defaultModel],
    modelCatalog: [{ id: defaultModel, name: defaultModel, enabled: true }],
    imageModel: kind === 'image' ? defaultModel : '',
    editModel: kind === 'image' ? defaultModel : '',
    imageCompatibilityMode: 'auto',
    timeoutMs: kind === 'image' ? 360000 : 60000,
    retryCount: 3,
    supportsWebpReferences: kind === 'image',
    notes: '',
  }
}

// Image providers historically stored a single image_model; fall back to it so
// editing an un-migrated row does not silently lose its configured model.
function providerLegacyModelIds(provider: AdminProviderSetting): string[] {
  if (provider.kind === 'image') return provider.imageModel ? [provider.imageModel] : []
  const models = (provider.models || []).filter(model => Boolean(model && model.trim()))
  if (models.length) return models
  return provider.defaultModel ? [provider.defaultModel] : []
}

function providerModelCatalogRows(provider: AdminProviderSetting): AdminProviderModel[] {
  if (provider.modelCatalog?.length) return provider.modelCatalog
  if (provider.models?.length) return provider.models.map(id => ({ id, name: id, enabled: true }))
  return providerLegacyModelIds(provider).map(model => ({ id: model, name: model, enabled: true }))
}

function editProvider(provider: AdminProviderSetting) {
  const modelCatalog = providerModelCatalogRows(provider).map(model => ({ ...model }))
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
    models: modelCatalog.map(model => model.id),
    modelCatalog,
    imageModel: provider.imageModel || '',
    editModel: provider.editModel || '',
    imageCompatibilityMode: provider.imageCompatibilityMode,
    timeoutMs: provider.timeoutMs,
    retryCount: provider.retryCount,
    supportsWebpReferences: provider.supportsWebpReferences,
    notes: provider.notes || '',
  }
}

function addProviderModel() {
  providerForm.value.modelCatalog.push({ id: '', name: '', enabled: true })
}

function removeProviderModel(index: number) {
  providerForm.value.modelCatalog.splice(index, 1)
}

function providerStatusLabel(provider: AdminProviderSetting) {
  if (provider.enabled && provider.apiKeyConfigured) return '已启用'
  if (provider.enabled) return '缺少 Key'
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

async function refreshSettings() {
  settingsLoading.value = true
  errorMessage.value = ''
  try {
    const data = await adminApiJson<{
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
    emit('roleChanged', currentAdminRole.value)
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
    const data = await adminApiJson<{ settings: AdminAppSettings }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        imageCreditCostPerImage: settingsPricePerImage.value,
        imageModelCreditCosts: normalizeModelPriceRows(settingsForm.value.imageModelCreditCosts),
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
    noticeMessage.value = t('settings.savedNotice', {
      cost: data.settings.imageCreditCostPerImage,
      count: data.settings.imageModelCreditCosts?.length || 0,
    })
    emit('dataChanged', 'settings')
  } catch (error) {
    setError(error)
  } finally {
    settingsSaving.value = false
  }
}

async function saveProvider() {
  if (!canManageAdminUsers.value) return setError(t('settings.onlySeniorCanManage'))
  providerActionId.value = providerForm.value.id || 'new'
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const isUpdate = Boolean(providerForm.value.id)
    const { id: _id, ...providerPayload } = providerForm.value
    providerPayload.modelCatalog = providerPayload.modelCatalog
      .map(model => ({ id: model.id.trim(), name: model.name.trim() || model.id.trim(), enabled: Boolean(model.enabled) }))
      .filter(model => model.id)
    providerPayload.models = providerPayload.modelCatalog.map(model => model.id)
    const defaultCatalogModel = providerPayload.modelCatalog.find(model => model.enabled)?.id
    if (providerPayload.kind === 'chat') {
      providerPayload.defaultModel = defaultCatalogModel || providerPayload.defaultModel.trim()
    } else {
      // 第一个启用项即默认生图模型；编辑模型仍由 editModel 显式指定。
      providerPayload.imageModel = defaultCatalogModel || providerPayload.imageModel.trim()
    }
    const data = await adminApiJson<{ provider: AdminProviderSetting; providerSettings: AdminProviderSettingsState }>(
      isUpdate ? `/api/admin/settings/providers/${encodeURIComponent(providerForm.value.id)}` : '/api/admin/settings/providers',
      { method: isUpdate ? 'PATCH' : 'POST', body: JSON.stringify(providerPayload) },
    )
    providerSettings.value = data.providerSettings
    resetProviderForm(providerForm.value.kind)
    noticeMessage.value = `Provider 已保存：${data.provider.name}`
    emit('dataChanged', 'settings')
  } catch (error) {
    setError(error, 'Provider 配置保存失败，请稍后重试。')
  } finally {
    providerActionId.value = null
  }
}

async function createAdminRule() {
  if (!canManageAdminUsers.value) return setError(t('settings.onlySeniorCanManage'))
  if (!adminUserForm.value.userId.trim() && !adminUserForm.value.email.trim()) return setError(t('feedback.enterUserIdOrEmail'))
  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ adminUsers: AdminUserRule[]; adminAccess: AdminAccessSummary }>('/api/admin/settings/admin-users', {
      method: 'POST',
      body: JSON.stringify(adminUserForm.value),
    })
    adminUserRules.value = data.adminUsers
    adminAccess.value = data.adminAccess
    adminUserForm.value = { userId: '', email: '', note: '' }
    noticeMessage.value = t('settings.ruleAdded')
    emit('dataChanged', 'settings')
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function setAdminRuleEnabled(rule: AdminUserRule, enabled: boolean) {
  if (rule.source !== 'database' || !canManageAdminUsers.value) return
  if (!enabled && !window.confirm(t('settings.confirmDisableRule'))) return
  adminRuleActionId.value = rule.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ adminUsers: AdminUserRule[]; adminAccess: AdminAccessSummary }>(
      `/api/admin/settings/admin-users/${encodeURIComponent(rule.id)}`,
      { method: 'PATCH', body: JSON.stringify({ enabled }) },
    )
    adminUserRules.value = data.adminUsers
    adminAccess.value = data.adminAccess
    noticeMessage.value = enabled ? t('settings.ruleEnabled') : t('settings.ruleDisabled')
    emit('dataChanged', 'settings')
  } catch (error) {
    setError(error)
  } finally {
    adminRuleActionId.value = null
  }
}

onMounted(refreshSettings)
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="min-h-0" aria-live="polite">
      <p v-if="errorMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-red-500/10 px-3 text-[13px] font-medium text-red-500">{{ errorMessage }}</p>
      <p v-else-if="noticeMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-600">{{ noticeMessage }}</p>
    </div>
    <div class="grid gap-4" :class="props.section === 'all' ? 'grid-cols-[minmax(280px,380px)_minmax(0,1fr)] max-lg:grid-cols-1' : 'grid-cols-1'">
      <div v-if="props.section !== 'providers'" class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div><h2 class="text-sm font-semibold">{{ t('settings.runtimeConfig') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ appSettings ? t('settings.loaded') : t('settings.waiting') }}</span></div>
          <Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button>
        </div>
        <form class="flex flex-col gap-3" @submit.prevent="saveSettings">
          <label class="flex flex-col gap-1" for="setting-image-price">
            <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.imagePrice') }}</span>
            <input id="setting-image-price" v-model.number="settingsForm.imageCreditCostPerImage" type="number" min="0.01" step="0.01" required class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 py-1 text-[13px]">
            <span class="text-[11px] text-[var(--text-muted)]">{{ t('settings.imagePriceHint') }}</span>
            <div class="mt-1.5 flex flex-wrap gap-1.5"><span v-for="item in settingsPricePreview" :key="item.label" class="inline-flex min-h-6 items-center rounded-md border border-border bg-[var(--bubble-bg)] px-2 text-[11px] text-[var(--text-muted)]">{{ item.label }} {{ item.value }} 额度</span></div>
          </label>
          <div class="flex flex-col gap-2 rounded-md border border-border bg-[var(--bubble-bg)] p-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.modelPriceTitle') }}</span>
                <span class="mt-0.5 block text-[11px] text-[var(--text-muted)]">{{ t('settings.modelPriceHint') }}</span>
              </div>
              <div class="flex shrink-0 gap-1.5">
                <Button type="button" variant="outline" size="sm" :disabled="!billableImageModelIds.length" @click="fillModelPriceRows()">{{ t('settings.modelPriceFill') }}</Button>
                <Button type="button" variant="outline" size="sm" @click="addModelPriceRow()"><Plus class="mr-1 h-4 w-4" />{{ t('common.add') }}</Button>
              </div>
            </div>
            <div v-for="(row, index) in settingsForm.imageModelCreditCosts" :key="index" class="grid grid-cols-[minmax(0,1fr)_minmax(0,120px)_auto_auto] items-center gap-2">
              <input :id="`setting-model-price-id-${index}`" v-model.trim="row.id" :list="`setting-model-price-options-${index}`" :placeholder="t('settings.modelPriceIdPlaceholder')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
              <datalist :id="`setting-model-price-options-${index}`"><option v-for="modelId in billableImageModelIds" :key="modelId" :value="modelId" /></datalist>
              <input :id="`setting-model-price-cost-${index}`" v-model.number="row.cost" type="number" min="0.01" step="0.01" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
              <span class="whitespace-nowrap text-[11px] text-[var(--text-muted)]">{{ t('settings.modelPriceEffective', { cost: effectiveModelPrice(row.cost) }) }}</span>
              <Button type="button" variant="ghost" size="icon" :aria-label="`删除第 ${index + 1} 条模型价格`" :title="t('settings.modelPriceRemove')" @click="removeModelPriceRow(index)"><Trash2 class="h-4 w-4" /></Button>
            </div>
            <span v-if="!settingsForm.imageModelCreditCosts.length" class="text-[11px] text-[var(--text-muted)]">{{ t('settings.modelPriceEmpty') }}</span>
          </div>
          <label class="flex flex-col gap-1"><span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.responseModel') }}</span><input id="setting-response-model" v-model.trim="settingsForm.imageResponsesModel" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 py-1 text-[13px]"></label>
          <label class="flex flex-col gap-1"><span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.imageModel') }}</span><input id="setting-image-model" v-model.trim="settingsForm.imageResponsesImageModel" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 py-1 text-[13px]"></label>
          <label v-for="field in ['imageAnalyticsEnabled','imageEventsEnabled','canvasContextEnabled','freeGenerationEnabled','guestGenerationEnabled'] as const" :key="field" class="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3">
            <input v-model="settingsForm[field]" :id="`setting-${field}`" type="checkbox" class="min-h-auto w-auto">
            <span class="text-[13px]">{{ t(`settings.${field === 'imageAnalyticsEnabled' ? 'analytics' : field === 'imageEventsEnabled' ? 'frontendEvents' : field === 'canvasContextEnabled' ? 'canvasContext' : field === 'freeGenerationEnabled' ? 'freeGeneration' : 'guestGeneration'}`) }}</span>
          </label>
          <Button type="submit" :disabled="settingsSaving || !settingsLoaded">{{ settingsSaving ? t('common.saving') : t('settings.saveConfig') }}</Button>
        </form>
      </div>

      <div v-if="props.section !== 'runtime'" class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">Provider / API Key</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ providerSettings?.tableAvailable ? '数据库配置' : '仅环境变量兜底' }}</span></div><Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button></div>
        <form v-if="canManageAdminUsers" class="flex flex-col gap-3" @submit.prevent="saveProvider">
          <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">类型</span><select id="provider-kind" v-model="providerForm.kind" :disabled="Boolean(providerForm.id)" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]" @change="resetProviderForm(providerForm.kind)"><option value="image">Image</option><option value="chat">Chat</option></select></label>
          <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">名称</span><input id="provider-name" v-model.trim="providerForm.name" required class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
          <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">Base URL</span><input id="provider-base-url" v-model.trim="providerForm.baseUrl" type="url" required class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
          <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">API Key</span><input id="provider-api-key" v-model.trim="providerForm.apiKey" type="password" autocomplete="new-password" :placeholder="editingProvider?.apiKeyConfigured ? `保持当前 ${editingProvider.apiKeyPreview || ''}` : '输入 API key'" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
          <label v-if="editingProvider?.apiKeyConfigured" class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3"><input id="provider-clear-api-key" v-model="providerForm.clearApiKey" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">清空当前 API Key</span></label>
          <div class="grid grid-cols-3 gap-2 max-md:grid-cols-1"><label v-for="field in ['priority','timeoutMs','retryCount'] as const" :key="field" class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ field === 'priority' ? '优先级' : field === 'timeoutMs' ? '超时 ms' : '重试' }}</span><input :id="`provider-${field}`" v-model.number="providerForm[field]" type="number" min="0" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label></div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between"><span class="text-xs text-[var(--text-muted)]">{{ providerForm.kind === 'chat' ? 'Chat 模型' : '生图模型目录' }}</span><Button type="button" variant="outline" size="sm" @click="addProviderModel"><Plus class="mr-1 h-4 w-4" />添加模型</Button></div>
            <div v-for="(model, index) in providerForm.modelCatalog" :key="index" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2">
              <input :id="`provider-model-id-${index}`" v-model.trim="model.id" :placeholder="index === 0 ? `模型 ID，例如 ${providerForm.kind === 'chat' ? 'gpt-4o-mini' : 'gpt-image-2'}` : '模型 ID'" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
              <input :id="`provider-model-name-${index}`" v-model.trim="model.name" :placeholder="index === 0 ? `展示名，例如 ${providerForm.kind === 'chat' ? 'GPT-4o Mini' : 'GPT Image 2'}` : '展示名'" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
              <label class="flex items-center gap-1 text-xs text-[var(--text-muted)]"><input v-model="model.enabled" type="checkbox" class="min-h-auto w-auto">启用</label>
              <Button type="button" variant="ghost" size="icon" :disabled="providerForm.modelCatalog.length <= 1" :aria-label="`删除模型 ${index + 1}`" title="删除模型" @click="removeProviderModel(index)"><Trash2 class="h-4 w-4" /></Button>
            </div>
            <span class="text-[11px] text-[var(--text-muted)]">同一个 Base URL 下可配置多个模型，模型 ID 需与上游服务一致。{{ providerForm.kind === 'image' ? '第一个启用项会作为默认生图模型。' : '' }}</span>
          </div>
          <template v-if="providerForm.kind === 'image'">
            <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">编辑模型（带参考图时使用）</span><input id="provider-edit-model" v-model.trim="providerForm.editModel" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
            <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">兼容预设</span><select id="provider-compat-mode" v-model="providerForm.imageCompatibilityMode" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"><option value="auto">自动判断</option><option value="openai">标准 OpenAI</option><option value="lucen">Lucen / sub2api OAuth</option></select></label>
            <label class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3"><input id="provider-webp-refs" v-model="providerForm.supportsWebpReferences" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">支持 WebP 参考图</span></label>
          </template>
          <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">备注</span><input id="provider-notes" v-model.trim="providerForm.notes" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
          <label class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3"><input id="provider-enabled" v-model="providerForm.enabled" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">启用</span></label>
          <div class="flex flex-wrap gap-2"><Button type="submit" :disabled="Boolean(providerActionId)">{{ providerActionId ? t('common.saving') : providerForm.id ? '保存 Provider' : '新增 Provider' }}</Button><Button variant="outline" type="button" @click="resetProviderForm(providerForm.kind)">重置</Button></div>
        </form>
        <p v-else class="mb-3 text-[13px] text-[var(--text-muted)]">{{ t('settings.noManagePermission') }}</p>
        <div class="mt-4 w-full overflow-x-auto rounded-md border border-border"><table class="w-full min-w-[760px] border-collapse text-[13px]"><thead><tr><th v-for="heading in ['类型','名称','模型目录','兼容','Key','状态','操作']" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="provider in providerRows" :key="provider.id" class="border-b border-border"><td class="px-3 py-2">{{ provider.kind }}</td><td class="px-3 py-2"><div class="font-semibold">{{ provider.name }}</div><div class="text-xs text-[var(--text-muted)]">优先级 {{ provider.priority }} · {{ provider.baseUrl }}</div></td><td class="px-3 py-2 text-xs"><div class="flex flex-col gap-0.5"><span v-for="(model, index) in providerModelCatalogRows(provider)" :key="`${model.id}-${index}`" :class="model.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] line-through'">{{ model.name || model.id }} <span class="text-[10px] text-[var(--text-muted)]">({{ model.id }})</span></span><span v-if="!providerModelCatalogRows(provider).length">{{ provider.defaultModel || provider.imageModel || '-' }}</span></div></td><td class="px-3 py-2 text-xs">{{ providerCompatibilityLabel(provider) }}</td><td class="px-3 py-2">{{ provider.apiKeyConfigured ? provider.apiKeyPreview || '已配置' : '未配置' }}</td><td class="px-3 py-2"><Badge :variant="provider.enabled && provider.apiKeyConfigured ? 'default' : 'secondary'">{{ providerStatusLabel(provider) }}</Badge></td><td class="px-3 py-2"><Button variant="ghost" size="sm" :disabled="provider.source !== 'database' || !canManageAdminUsers" @click="editProvider(provider)">编辑</Button></td></tr><tr v-if="!providerRows.length"><td colspan="7" class="px-3 py-6 text-center text-[var(--text-muted)]">暂无 Provider 配置</td></tr></tbody></table></div>
        <div class="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border"><div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">Image Providers</span><strong class="block text-xl">{{ imageProviderRows.length }}</strong></div><div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">Chat Providers</span><strong class="block text-xl">{{ chatProviderRows.length }}</strong></div></div>
      </div>

      <div v-if="props.section === 'all'" class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">{{ t('settings.adminUsers') }}</h2><span class="text-xs text-[var(--text-muted)]">{{ adminRuleTotal }}</span></div><Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button></div>
        <form v-if="canManageAdminUsers" class="mb-4 flex flex-wrap items-end gap-2" @submit.prevent="createAdminRule"><label class="flex min-w-[160px] flex-1 flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminUserId') }}</span><input id="admin-user-id" v-model.trim="adminUserForm.userId" :placeholder="t('settings.adminUserId')" class="min-h-[30px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"></label><label class="flex min-w-[160px] flex-1 flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminEmail') }}</span><input id="admin-user-email" v-model.trim="adminUserForm.email" type="email" :placeholder="t('settings.adminEmail')" class="min-h-[30px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"></label><label class="flex min-w-[160px] flex-1 flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminNote') }}</span><input id="admin-user-note" v-model.trim="adminUserForm.note" :placeholder="t('settings.adminNote')" class="min-h-[30px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"></label><Button type="submit" :disabled="actionLoading">{{ t('common.add') }}</Button></form>
        <p v-else class="mb-3 text-[13px] text-[var(--text-muted)]">{{ t('settings.noManagePermission') }}</p>
        <div class="w-full overflow-x-auto rounded-md border border-border"><table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('settings.adminTable.account'),t('settings.adminTable.level'),t('settings.adminTable.source'),t('settings.adminTable.status'),t('settings.adminTable.updated'),t('settings.adminTable.actions')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="rule in adminUserRules" :key="rule.id" class="border-b border-border"><td class="px-3 py-2">{{ adminRuleIdentity(rule) }}</td><td class="px-3 py-2"><Badge variant="secondary">{{ adminRuleRoleLabel(rule) }}</Badge></td><td class="px-3 py-2 text-xs">{{ adminRuleSource(rule) }}</td><td class="px-3 py-2" :class="rule.enabled ? 'text-emerald-600' : 'text-red-500'">{{ rule.enabled ? t('settings.statusEnabled') : t('settings.statusDisabled') }}</td><td class="px-3 py-2 text-xs">{{ dateTime(rule.updatedAt) }}</td><td class="px-3 py-2"><Button variant="ghost" size="sm" :disabled="!canManageAdminUsers || rule.source !== 'database' || adminRuleActionId === rule.id" @click="setAdminRuleEnabled(rule, !rule.enabled)">{{ rule.enabled ? t('common.disable') : t('common.enable') }}</Button></td></tr><tr v-if="!adminUserRules.length"><td colspan="6" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('settings.noRules') }}</td></tr></tbody></table></div>
      </div>
    </div>
  </section>
</template>
