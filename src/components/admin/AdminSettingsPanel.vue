<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2 } from '@lucide/vue'
import { adminApiJson } from '../../composables/useAdminApi'
import AdminStatusBanner from './AdminStatusBanner.vue'
import AdminProviderSettingsPanel from './AdminProviderSettingsPanel.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useConfirmAction } from '../../composables/useConfirmAction'
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
import { adminErrorMessage, dateTime, shortId } from '../../utils/admin-format'
import { providerModelCatalogRows } from '../../utils/admin-providers'
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
const adminRuleActionId = ref<string | null>(null)
const ruleConfirm = useConfirmAction()
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
const adminUserForm = ref({ userId: '', email: '', note: '' })

const settingsPricePerImage = computed(() => {
  const cost = normalizeCreditBalance(settingsForm.value.imageCreditCostPerImage)
  return cost !== null ? Math.max(0.01, cost) : 1
})
const settingsPricePreview = computed(() => [1, 4, 8].map(count => ({
  label: t('settings.priceCountLabel', { count }),
  value: settingsPricePerImage.value * count,
})))
const providerRows = computed(() => providerSettings.value?.providers || [])
const imageProviderRows = computed(() => providerRows.value.filter(provider => provider.kind === 'image'))

/**
 * 可能被计费的模型清单，用于「按模型定价」的取值候选。
 *
 * 为什么要带上 editModel：带参考图的请求走 /images/edits，扣费模型是编辑模型，
 * 它与默认生图模型是两条独立的计费路径，必须能分别定价。编辑模型有两处来源：
 * Provider 级 edit_model（行内未配置时的兜底），以及每个目录行自己的 editModel
 * （行内优先，真正扣费的就是它），所以两者都要进候选。
 */
const billableImageModelIds = computed(() => {
  const ids: string[] = []
  const push = (value?: string | null) => {
    const id = (value || '').trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  for (const provider of imageProviderRows.value) {
    for (const model of providerModelCatalogRows(provider)) {
      if (!model.enabled) continue
      push(model.id)
      // 行内编辑模型是带参考图请求的真实扣费模型，必须能单独定价。
      push(model.editModel)
    }
    push(provider.editModel)
    push(provider.imageModel)
  }
  push(settingsForm.value.imageResponsesImageModel)
  return ids
})

/**
 * 已启用 Provider 目录里真正可以出图的模型清单。
 *
 * 与 billableImageModelIds 的区别是「能不能用」和「会不会被计费」两回事：
 * 计费候选还要包含编辑模型、默认模型等只是可能产生费用的 ID，且不要求
 * Provider 处于启用状态。用计费候选去判断可用性，会让已停用 Provider 的模型
 * 显示成可用，用户选中后实际回退到别的模型生成。
 *
 * 因此这里只看「启用中、且配了目录行」的 Provider，取行内启用的模型 ID。
 * 不取 editModel / imageModel 兜底：它们不是用户可以直接选的生图模型。
 */
const enabledImageModelIds = computed(() => {
  const ids: string[] = []
  for (const provider of imageProviderRows.value) {
    if (!provider.enabled) continue
    for (const model of providerModelCatalogRows(provider)) {
      if (!model.enabled) continue
      const id = (model.id || '').trim()
      if (id && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
})

/** 某模型的生效单价：命中覆盖价用覆盖价，否则回退兜底价。 */
function effectiveModelPrice(cost: number | null | undefined) {
  const value = normalizeCreditBalance(cost ?? 0)
  return value !== null && value >= 0.01 ? value : settingsPricePerImage.value
}


/**
 * 可见模型列表是否与载入时不同。
 *
 * 用于避免「保存无关设置时顺带覆盖别人刚改的列表」：列表是整体提交的，
 * 未改动就不该出现在 PATCH 里。
 */
function visibleModelsDirty() {
  const current = normalizeVisibleModels(settingsForm.value.availableImageModels)
  const loaded = normalizeVisibleModels(appSettings.value?.availableImageModels)
  return JSON.stringify(current) !== JSON.stringify(loaded)
}

/** 某个可见模型是否仍由已启用 Provider 提供；不提供时要给出警示。 */
function isVisibleModelAvailable(modelId: string) {
  return enabledImageModelIds.value.includes(modelId.trim())
}

function addVisibleModel(modelId = '') {
  const rows = settingsForm.value.availableImageModels
  if (modelId) {
    rows.push({ id: modelId, name: '', supportsTransparent: false })
    return
  }
  if (!rows.length) {
    // 首次展开时带入所有已启用模型，管理员按需删减而不是逐个手打。
    fillVisibleModels()
  }
  // 没有候选可补时仍要给出一个空行：否则表格保持空的，管理员无从下手。
  if (!rows.length) {
    rows.push({ id: '', name: '', supportsTransparent: false })
  }
}

function removeVisibleModel(index: number) {
  settingsForm.value.availableImageModels.splice(index, 1)
}

/** 把已启用 Provider 提供的模型补进可见列表，展示名留空表示沿用模型 ID。 */
function fillVisibleModels() {
  const rows = settingsForm.value.availableImageModels
  const existing = new Set(rows.map(row => row.id.trim()).filter(Boolean))
  for (const id of enabledImageModelIds.value) {
    if (existing.has(id)) continue
    rows.push({ id, name: '', supportsTransparent: false })
    existing.add(id)
  }
}

/**
 * 提交给接口的可见模型列表：丢掉空行并按 id 去重。
 *
 * supportsTransparent 要一并回传：它是模型的能力位，只在后端落库。载入时若
 * 丢掉、提交时又只给 id 和 name，管理员哪怕只改价格也会让后端把它规范化成
 * false，把透明背景能力悄悄关掉。
 */
function normalizeVisibleModels(rows: Array<{ id: string; name?: string; supportsTransparent?: boolean }> | undefined) {
  const result: Array<{ id: string; name: string; supportsTransparent: boolean }> = []
  const seen = new Set<string>()
  for (const row of rows || []) {
    const id = (row?.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      name: (row?.name || '').trim(),
      supportsTransparent: Boolean(row?.supportsTransparent),
    })
  }
  return result
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

const adminRuleTotal = computed(() => adminAccess.value
  ? adminAccess.value.databaseCount + adminAccess.value.envUserIdCount + adminAccess.value.envEmailCount
  : adminUserRules.value.length)
const canManageAdminUsers = computed(() => currentAdminRole.value === 'senior')

function setError(error: unknown, fallback = t('feedback.operationFailed')) {
  errorMessage.value = adminErrorMessage(error, fallback)
}

// Provider 区块已抽成子组件：它在自己的作用域里清空并格式化消息，父组件只负责接住。
function clearProviderMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function providerError(message: string) {
  errorMessage.value = message
}

function syncSettingsForm(settings: AdminAppSettings) {
  appSettings.value = settings
  settingsForm.value = {
    ...settings,
    // 覆盖价行要能被就地编辑，必须与接口返回的对象断开引用，
    // 否则未保存的改动会污染 appSettings 里的快照。
    imageModelCreditCosts: (settings.imageModelCreditCosts || []).map(row => ({ ...row })),
    // 可见模型同理：就地增删不能改动接口快照，同时保留 supportsTransparent
    // 这个能力位，避免「只改价格」的保存把它覆盖成 false。
    availableImageModels: (settings.availableImageModels || []).map(row => ({
      id: row.id,
      name: row.name || '',
      supportsTransparent: Boolean(row.supportsTransparent),
    })),
  }
  settingsLoaded.value = true
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
        // 只在可见模型确实被改动时才提交。
        //
        // 它是一整份列表，无条件提交会让「A 打开页面、B 改了列表、A 保存了
        // 无关设置」这种时序把 B 的改动覆盖回 A 手里的旧快照。其余标量设置
        // 没有这个问题，它们每次提交的就是当前表单值。
        ...(visibleModelsDirty()
          ? { availableImageModels: normalizeVisibleModels(settingsForm.value.availableImageModels) }
          : {}),
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

function setAdminRuleEnabled(rule: AdminUserRule, enabled: boolean) {
  if (rule.source !== 'database' || !canManageAdminUsers.value) return
  // 停用规则会立即收回后台访问权限，先弹就地确认。
  if (!enabled) {
    ruleConfirm.request(() => applyAdminRuleEnabled(rule, false))
    return
  }
  return applyAdminRuleEnabled(rule, true)
}
async function applyAdminRuleEnabled(rule: AdminUserRule, enabled: boolean) {
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
    <AdminStatusBanner :error="errorMessage" :notice="noticeMessage" />
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
            <div class="mt-1.5 flex flex-wrap gap-1.5"><span v-for="item in settingsPricePreview" :key="item.label" class="inline-flex min-h-6 items-center rounded-md border border-border bg-[var(--bubble-bg)] px-2 text-[11px] text-[var(--text-muted)]">{{ item.label }} {{ item.value }} {{ t('settings.creditUnit') }}</span></div>
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
              <Button type="button" variant="ghost" size="icon" :aria-label="t('settings.providerRemoveModelPriceAria', { index: index + 1 })" :title="t('settings.modelPriceRemove')" @click="removeModelPriceRow(index)"><Trash2 class="h-4 w-4" /></Button>
            </div>
            <span v-if="!settingsForm.imageModelCreditCosts.length" class="text-[11px] text-[var(--text-muted)]">{{ t('settings.modelPriceEmpty') }}</span>
          </div>
          <div class="flex flex-col gap-2 rounded-md border border-border bg-[var(--bubble-bg)] p-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('settings.visibleModelsTitle') }}</span>
                <span class="mt-0.5 block text-[11px] text-[var(--text-muted)]">{{ t('settings.visibleModelsHint') }}</span>
              </div>
              <div class="flex shrink-0 gap-1.5">
                <Button type="button" variant="outline" size="sm" :disabled="!enabledImageModelIds.length" @click="fillVisibleModels()">{{ t('settings.visibleModelsFill') }}</Button>
                <Button type="button" variant="outline" size="sm" @click="addVisibleModel()"><Plus class="mr-1 h-4 w-4" />{{ t('common.add') }}</Button>
              </div>
            </div>
            <div v-for="(row, index) in settingsForm.availableImageModels" :key="index" class="flex flex-col gap-1">
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                <input :id="`setting-visible-model-id-${index}`" v-model.trim="row.id" :list="`setting-visible-model-options-${index}`" :placeholder="t('settings.modelPriceIdPlaceholder')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
                <datalist :id="`setting-visible-model-options-${index}`"><option v-for="modelId in enabledImageModelIds" :key="modelId" :value="modelId" /></datalist>
                <input :id="`setting-visible-model-name-${index}`" v-model.trim="row.name" :placeholder="t('settings.visibleModelsNamePlaceholder')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
                <Button type="button" variant="ghost" size="icon" :aria-label="t('settings.visibleModelsRemoveAria', { index: index + 1 })" :title="t('settings.visibleModelsRemove')" @click="removeVisibleModel(index)"><Trash2 class="h-4 w-4" /></Button>
              </div>
              <span v-if="row.id.trim() && !isVisibleModelAvailable(row.id)" class="text-[11px] text-[var(--text-muted)]">{{ t('settings.visibleModelsUnavailable') }}</span>
            </div>
            <span v-if="!settingsForm.availableImageModels.length" class="text-[11px] text-[var(--text-muted)]">{{ t('settings.visibleModelsEmpty') }}</span>
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

      <AdminProviderSettingsPanel
        v-if="props.section !== 'runtime'"
        :provider-settings="providerSettings"
        :can-manage="canManageAdminUsers"
        :loading="settingsLoading"
        @refresh="refreshSettings"
        @clear="clearProviderMessages"
        @saved="providerSettings = $event"
        @notice="noticeMessage = $event"
        @error="providerError"
        @data-changed="emit('dataChanged', 'settings')"
      />

      <div v-if="props.section === 'all'" class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">{{ t('settings.adminUsers') }}</h2><span class="text-xs text-[var(--text-muted)]">{{ adminRuleTotal }}</span></div><Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button></div>
        <form v-if="canManageAdminUsers" class="mb-4 flex flex-wrap items-end gap-2" @submit.prevent="createAdminRule"><label class="flex min-w-[160px] flex-1 flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminUserId') }}</span><input id="admin-user-id" v-model.trim="adminUserForm.userId" :placeholder="t('settings.adminUserId')" class="min-h-[30px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"></label><label class="flex min-w-[160px] flex-1 flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminEmail') }}</span><input id="admin-user-email" v-model.trim="adminUserForm.email" type="email" :placeholder="t('settings.adminEmail')" class="min-h-[30px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"></label><label class="flex min-w-[160px] flex-1 flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminNote') }}</span><input id="admin-user-note" v-model.trim="adminUserForm.note" :placeholder="t('settings.adminNote')" class="min-h-[30px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"></label><Button type="submit" :disabled="actionLoading">{{ t('common.add') }}</Button></form>
        <p v-else class="mb-3 text-[13px] text-[var(--text-muted)]">{{ t('settings.noManagePermission') }}</p>
        <div class="w-full overflow-x-auto rounded-md border border-border"><table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('settings.adminTable.account'),t('settings.adminTable.level'),t('settings.adminTable.source'),t('settings.adminTable.status'),t('settings.adminTable.updated'),t('settings.adminTable.actions')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="rule in adminUserRules" :key="rule.id" class="border-b border-border"><td class="px-3 py-2">{{ adminRuleIdentity(rule) }}</td><td class="px-3 py-2"><Badge variant="secondary">{{ adminRuleRoleLabel(rule) }}</Badge></td><td class="px-3 py-2 text-xs">{{ adminRuleSource(rule) }}</td><td class="px-3 py-2" :class="rule.enabled ? 'text-success' : 'text-danger'">{{ rule.enabled ? t('settings.statusEnabled') : t('settings.statusDisabled') }}</td><td class="px-3 py-2 text-xs">{{ dateTime(rule.updatedAt) }}</td><td class="px-3 py-2"><Button variant="ghost" size="sm" :disabled="!canManageAdminUsers || rule.source !== 'database' || adminRuleActionId === rule.id" @click="setAdminRuleEnabled(rule, !rule.enabled)">{{ rule.enabled ? t('common.disable') : t('common.enable') }}</Button></td></tr><tr v-if="!adminUserRules.length"><td colspan="6" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('settings.noRules') }}</td></tr></tbody></table></div>
      </div>
    </div>

    <ConfirmDialog
      v-model:open="ruleConfirm.open.value"
      :title="t('settings.confirmDisableRuleTitle')"
      :description="t('settings.confirmDisableRuleDetail')"
      :confirm-label="t('settings.confirmDisableRuleAction')"
      destructive
      @confirm="ruleConfirm.confirm()"
    />
  </section>
</template>
