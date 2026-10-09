<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminApiJson } from '../../composables/useAdminApi'
import AdminStatusBanner from './AdminStatusBanner.vue'
import AdminProviderSettingsPanel from './AdminProviderSettingsPanel.vue'
import AdminField from './AdminField.vue'
import AdminSettingsGroup from './AdminSettingsGroup.vue'
import AdminModelPricingSection from './AdminModelPricingSection.vue'
import AdminVisibleModelsSection from './AdminVisibleModelsSection.vue'
import AdminUserRulesPanel from './AdminUserRulesPanel.vue'
import type {
  AdminAccessSummary,
  AdminAppSettings,
  AdminProviderSettingsState,
  AdminRole,
  AdminUserRule,
} from '../../types/admin'
import { adminErrorMessage } from '../../utils/admin-format'
import { providerModelCatalogRows } from '../../utils/admin-providers'
import { normalizeCreditBalance } from '../../utils/credit-format'
import {
  normalizeModelPriceRows,
  normalizeVisibleModels,
  visibleModelsDirty,
  type ModelPriceRow,
  type VisibleModelRow,
} from '../../utils/admin-runtime-settings'

/**
 * 表单里的设置：与接口返回的 AdminAppSettings 同形，但列表字段用组件契约的类型。
 *
 * 接口类型里 availableImageModels 的 supportsTransparent 是可选的（旧行没有它），
 * 而表单在载入时已把它补成布尔值；用必填类型表达这件事，子组件才不用到处判空。
 */
type SettingsForm = Omit<AdminAppSettings, 'imageModelCreditCosts' | 'availableImageModels'> & {
  imageModelCreditCosts: ModelPriceRow[]
  availableImageModels: VisibleModelRow[]
}

/**
 * 运行时配置页的编排层。
 *
 * 它只负责三件事：拉取与保存整页配置、在子面板之间转递消息、按 section 决定
 * 渲染哪些区块。每一块设置的具体行为都在各自的子组件里。
 */
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
const errorMessage = ref('')
const noticeMessage = ref('')
const appSettings = ref<AdminAppSettings | null>(null)
const providerSettings = ref<AdminProviderSettingsState | null>(null)
const adminUserRules = ref<AdminUserRule[]>([])
const adminAccess = ref<AdminAccessSummary | null>(null)
const currentAdminRole = ref<AdminRole>('operator')

const settingsForm = ref<SettingsForm>({
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

const settingsPricePerImage = computed(() => {
  const cost = normalizeCreditBalance(settingsForm.value.imageCreditCostPerImage)
  return cost !== null ? Math.max(0.01, cost) : 1
})

const settingsPricePreview = computed(() => [1, 4, 8].map(count => ({
  label: t('settings.priceCountLabel', { count }),
  value: settingsPricePerImage.value * count,
})))

const imageProviderRows = computed(() =>
  (providerSettings.value?.providers || []).filter(provider => provider.kind === 'image'))

/**
 * 可能被计费的模型清单，作为「按模型定价」的取值候选。
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
 * 与 billableImageModelIds 的区别是「能不能用」和「会不会被计费」两回事：计费候选
 * 还包含编辑模型、默认模型等只是可能产生费用的 ID，且不要求 Provider 处于启用状态。
 * 用计费候选判断可用性，会把已停用 Provider 的模型显示成可用。
 *
 * 这里与后端的 Provider 推导保持同一条件：启用还不够，必须也配好了凭据。只看
 * enabled 会把没有密钥的 Provider 也标成可用，管理员据此保存的可见列表就包含
 * 实际出不了图的模型——而手填的非空列表会覆盖后端推导，等于把错误公开出去。
 */
const enabledImageModelIds = computed(() => {
  const ids: string[] = []
  for (const provider of imageProviderRows.value) {
    if (!provider.enabled || !provider.apiKeyConfigured) continue
    for (const model of providerModelCatalogRows(provider)) {
      if (!model.enabled) continue
      const id = (model.id || '').trim()
      if (id && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
})

const canManageAdminUsers = computed(() => currentAdminRole.value === 'senior')

/** 开关字段的渲染顺序与文案键，避免在模板里写一长串三元表达式。 */
const TOGGLE_FIELDS = [
  { field: 'imageAnalyticsEnabled', labelKey: 'settings.analytics' },
  { field: 'imageEventsEnabled', labelKey: 'settings.frontendEvents' },
  { field: 'canvasContextEnabled', labelKey: 'settings.canvasContext' },
  { field: 'freeGenerationEnabled', labelKey: 'settings.freeGeneration' },
  { field: 'guestGenerationEnabled', labelKey: 'settings.guestGeneration' },
] as const

function setError(error: unknown, fallback = t('feedback.operationFailed')) {
  errorMessage.value = adminErrorMessage(error, fallback)
}

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function syncSettingsForm(settings: AdminAppSettings) {
  appSettings.value = settings
  settingsForm.value = {
    ...settings,
    // 覆盖价行要能被就地编辑，必须与接口返回的对象断开引用，否则未保存的改动
    // 会污染 appSettings 里的快照。
    imageModelCreditCosts: (settings.imageModelCreditCosts || []).map(row => ({ ...row })),
    // 可见模型同理：就地增删不能改动接口快照，同时保留 supportsTransparent 这个
    // 能力位，避免「只改价格」的保存把它覆盖成 false。
    availableImageModels: (settings.availableImageModels || []).map(row => ({
      id: row.id,
      name: row.name || '',
      supportsTransparent: Boolean(row.supportsTransparent),
    })),
  }
  settingsLoaded.value = true
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
  clearMessages()
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
        // 只在可见模型确实被改动时才提交。它是一整份列表，无条件提交会让
        // 「A 打开页面、B 改了列表、A 保存了无关设置」这种时序把 B 的改动覆盖回
        // A 手里的旧快照。其余标量设置没有这个问题。
        ...(visibleModelsDirty(settingsForm.value.availableImageModels, appSettings.value?.availableImageModels)
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

function handleRulesUpdated(payload: { adminUsers: AdminUserRule[]; adminAccess: AdminAccessSummary }) {
  adminUserRules.value = payload.adminUsers
  adminAccess.value = payload.adminAccess
  emit('dataChanged', 'settings')
}

onMounted(refreshSettings)
</script>

<template>
  <section class="flex flex-col gap-4">
    <AdminStatusBanner :error="errorMessage" :notice="noticeMessage" />
    <div class="grid gap-4" :class="props.section === 'all' ? 'grid-cols-[minmax(280px,380px)_minmax(0,1fr)] max-lg:grid-cols-1' : 'grid-cols-1'">
      <div v-if="props.section !== 'providers'" class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">{{ t('settings.runtimeConfig') }}</h2>
            <span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ appSettings ? t('settings.loaded') : t('settings.waiting') }}</span>
          </div>
          <Button variant="outline" size="sm" :disabled="settingsLoading" @click="refreshSettings">{{ t('common.refresh') }}</Button>
        </div>

        <form class="flex flex-col gap-3" @submit.prevent="saveSettings">
          <!-- 常用的放最上面，低频的收起，主列只留真正会改的东西。 -->
          <AdminSettingsGroup
            :title="t('settings.groupBillingTitle')"
            :hint="t('settings.groupBillingHint')"
          >
            <AdminField
              id="setting-image-price"
              :label="t('settings.imagePrice')"
              :hint="t('settings.imagePriceHint')"
            >
              <Input
                id="setting-image-price"
                v-model.number="settingsForm.imageCreditCostPerImage"
                type="number"
                min="0.01"
                step="0.01"
                required
              />
              <template #after>
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  <span
                    v-for="item in settingsPricePreview"
                    :key="item.label"
                    class="inline-flex min-h-6 items-center rounded-md border border-border bg-[var(--bubble-bg)] px-2 text-[11px] text-[var(--text-muted)]"
                  >
                    {{ item.label }} {{ item.value }} {{ t('settings.creditUnit') }}
                  </span>
                </div>
              </template>
            </AdminField>

            <AdminModelPricingSection
              v-model="settingsForm.imageModelCreditCosts"
              :candidates="billableImageModelIds"
              :fallback-price="settingsPricePerImage"
            />
          </AdminSettingsGroup>

          <AdminSettingsGroup
            :title="t('settings.groupModelsTitle')"
            :hint="t('settings.groupModelsHint')"
          >
            <AdminVisibleModelsSection
              v-model="settingsForm.availableImageModels"
              :available-ids="enabledImageModelIds"
            />

            <div class="grid gap-3 sm:grid-cols-2">
              <AdminField id="setting-response-model" :label="t('settings.responseModel')">
                <Input id="setting-response-model" v-model.trim="settingsForm.imageResponsesModel" />
              </AdminField>

              <AdminField id="setting-image-model" :label="t('settings.imageModel')">
                <Input id="setting-image-model" v-model.trim="settingsForm.imageResponsesImageModel" />
              </AdminField>
            </div>
          </AdminSettingsGroup>

          <AdminSettingsGroup
            :title="t('settings.groupFlagsTitle')"
            :hint="t('settings.groupFlagsHint')"
            :default-open="false"
          >
            <div class="grid gap-2 sm:grid-cols-2">
              <label
                v-for="item in TOGGLE_FIELDS"
                :key="item.field"
                :for="`setting-${item.field}`"
                class="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3"
              >
                <input :id="`setting-${item.field}`" v-model="settingsForm[item.field]" type="checkbox" class="min-h-auto w-auto">
                <span class="text-[13px]">{{ t(item.labelKey) }}</span>
              </label>
            </div>
          </AdminSettingsGroup>

          <Button type="submit" :disabled="settingsSaving || !settingsLoaded">
            {{ settingsSaving ? t('common.saving') : t('settings.saveConfig') }}
          </Button>
        </form>
      </div>

      <AdminProviderSettingsPanel
        v-if="props.section !== 'runtime'"
        :provider-settings="providerSettings"
        :can-manage="canManageAdminUsers"
        :loading="settingsLoading"
        @refresh="refreshSettings"
        @clear="clearMessages"
        @saved="providerSettings = $event"
        @notice="noticeMessage = $event"
        @error="errorMessage = $event"
        @data-changed="emit('dataChanged', 'settings')"
      />

      <AdminUserRulesPanel
        v-if="props.section === 'all'"
        :rules="adminUserRules"
        :access="adminAccess"
        :can-manage="canManageAdminUsers"
        :loading="settingsLoading"
        @refresh="refreshSettings"
        @clear="clearMessages"
        @error="setError"
        @notice="noticeMessage = $event"
        @updated="handleRulesUpdated"
      />
    </div>
  </section>
</template>
