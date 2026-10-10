<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2 } from '@lucide/vue'
import { adminApiJson } from '../../composables/useAdminApi'
import { useConfirmAction } from '../../composables/useConfirmAction'
import { adminErrorMessage } from '../../utils/admin-format'
import { providerModelCatalogRows } from '../../utils/admin-providers'
import AdminField from './AdminField.vue'
import AdminSettingsGroup from './AdminSettingsGroup.vue'
import AdminSettingsSection from './AdminSettingsSection.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import type {
  AdminProviderModel,
  AdminProviderSetting,
  AdminProviderSettingsState,
  ImageProviderCompatibilityMode,
} from '../../types/admin'

const props = defineProps<{
  providerSettings: AdminProviderSettingsState | null
  canManage: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  clear: []
  saved: [settings: AdminProviderSettingsState]
  notice: [message: string]
  error: [message: string]
  dataChanged: []
}>()

const { t } = useI18n()

const providerActionId = ref<string | null>(null)
/** 保存期间整表单只读:否则成功后的 resetProviderForm 会抹掉请求发出后新填的内容。 */
const formBusy = computed(() => Boolean(providerActionId.value))
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

const providerRows = computed(() => props.providerSettings?.providers || [])
const imageProviderRows = computed(() => providerRows.value.filter(provider => provider.kind === 'image'))
const chatProviderRows = computed(() => providerRows.value.filter(provider => provider.kind === 'chat'))
/**
 * 模型行的列宽。
 *
 * 生图行多一个「编辑模型」输入，Chat 行只有 ID + 展示名。列头与数据行共用同一份
 * 定义，标签才会和输入框对齐。窄屏放不下这些固定宽度，由模板上的 max-sm: 类切成
 * 单列——否则网格横向溢出，删除按钮会被推出可视区域。
 */
const modelGridStyle = computed(() => providerForm.value.kind === 'image'
  ? 'grid-template-columns: minmax(120px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) 76px 56px 32px;'
  : 'grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) 56px 32px;')

const editingProvider = computed(() => providerForm.value.id
  ? providerRows.value.find(provider => provider.id === providerForm.value.id) || null
  : null)

function resetProviderForm(kind: 'chat' | 'image' = 'image') {
  const defaultModel = kind === 'chat' ? 'gpt-4o-mini' : 'gpt-image-2'
  providerForm.value = {
    id: '', kind, name: '', baseUrl: '', apiKey: '', clearApiKey: false, enabled: true,
    priority: 100,
    defaultModel: kind === 'chat' ? defaultModel : '',
    models: [defaultModel],
    modelCatalog: [{ id: defaultModel, name: defaultModel, enabled: true, editModel: null, supportsTransparent: false }],
    imageModel: kind === 'image' ? defaultModel : '',
    editModel: kind === 'image' ? defaultModel : '',
    imageCompatibilityMode: 'auto',
    timeoutMs: kind === 'image' ? 360000 : 60000,
    retryCount: 3,
    supportsWebpReferences: kind === 'image',
    notes: '',
  }
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
  providerForm.value.modelCatalog.push({ id: '', name: '', enabled: true, editModel: null, supportsTransparent: false })
}

function removeProviderModel(index: number) {
  providerForm.value.modelCatalog.splice(index, 1)
}

function providerStatusLabel(provider: AdminProviderSetting) {
  if (provider.enabled && provider.apiKeyConfigured) return t('settings.providerStatusEnabled')
  if (provider.enabled) return t('settings.providerStatusMissingKey')
  return t('settings.providerStatusDisabled')
}

function providerCompatibilityLabel(provider: AdminProviderSetting) {
  if (provider.kind !== 'image') return '-'
  if (provider.imageCompatibilityMode === 'openai') return t('settings.providerCompatOpenai')
  if (provider.imageCompatibilityMode === 'lucen') return 'Lucen / sub2api'
  return t('settings.providerCompatAuto')
}

/** 删除确认：删掉后该 Provider 立刻从列表与生图链路消失，所以要二次确认。 */
const confirm = useConfirmAction()
const deletingId = ref<string | null>(null)

/**
 * 软删除一个 Provider。
 *
 * 只对数据库来源的行可用：环境变量兜底的 Provider 没有表记录，它的启停由部署
 * 配置决定，后台不该改写它。
 */
function requestDeleteProvider(provider: AdminProviderSetting) {
  if (!props.canManage) return emit('error', t('settings.onlySeniorCanManage'))
  if (provider.source !== 'database') return
  if (deletingId.value) return
  confirm.request(() => deleteProvider(provider))
}

async function deleteProvider(provider: AdminProviderSetting) {
  deletingId.value = provider.id
  emit('clear')
  try {
    const data = await adminApiJson<{ providerSettings: AdminProviderSettingsState }>(
      `/api/admin/settings/providers/${encodeURIComponent(provider.id)}`,
      { method: 'DELETE' },
    )
    emit('saved', data.providerSettings)
    // 删掉的正是正在编辑的那条时清空表单，否则保存会打到已下线的记录上。
    if (providerForm.value.id === provider.id) resetProviderForm(providerForm.value.kind)
    emit('notice', t('settings.providerDeleted', { name: provider.name }))
    emit('dataChanged')
  } catch (error) {
    emit('error', adminErrorMessage(error, t('feedback.providerDeleteFailed')))
  } finally {
    deletingId.value = null
  }
}

async function saveProvider() {
  if (!props.canManage) return emit('error', t('settings.onlySeniorCanManage'))
  providerActionId.value = providerForm.value.id || 'new'
  emit('clear')
  try {
    const isUpdate = Boolean(providerForm.value.id)
    const { id: _id, ...providerPayload } = providerForm.value
    providerPayload.modelCatalog = providerPayload.modelCatalog
      .map(model => ({
        id: model.id.trim(),
        name: model.name.trim() || model.id.trim(),
        enabled: Boolean(model.enabled),
        editModel: (model.editModel || '').trim() || null,
        supportsTransparent: Boolean(model.supportsTransparent),
      }))
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
    emit('saved', data.providerSettings)
    resetProviderForm(providerForm.value.kind)
    emit('notice', t('settings.providerSaved', { name: data.provider.name }))
    emit('dataChanged')
  } catch (error) {
    emit('error', adminErrorMessage(error, t('feedback.providerSaveFailed')))
  } finally {
    providerActionId.value = null
  }
}
</script>

<template>
  <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
    <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">{{ t('settings.providerSection') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ props.providerSettings?.tableAvailable ? t('settings.providerSourceDb') : t('settings.providerSourceEnv') }}</span></div><Button variant="outline" size="sm" :disabled="props.loading" @click="emit('refresh')">{{ t('common.refresh') }}</Button></div>
    <form v-if="props.canManage" class="flex flex-col px-5 py-2" @submit.prevent="saveProvider">
      <AdminSettingsGroup :title="t('settings.providerGroupConnection')" :hint="t('settings.providerGroupConnectionHint')">
        <AdminField id="provider-kind" :label="t('settings.providerKind')">
          <select id="provider-kind" v-model="providerForm.kind" :disabled="Boolean(providerForm.id) || formBusy" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]" @change="resetProviderForm(providerForm.kind)"><option value="image">Image</option><option value="chat">Chat</option></select>
        </AdminField>
        <AdminField id="provider-name" :label="t('settings.providerName')">
          <input id="provider-name" v-model.trim="providerForm.name" :disabled="formBusy" required class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
        </AdminField>
        <AdminField id="provider-base-url" label="Base URL">
          <input id="provider-base-url" v-model.trim="providerForm.baseUrl" :disabled="formBusy" type="url" required class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
        </AdminField>
        <AdminField id="provider-api-key" :label="t('settings.providerApiKey')">
          <input id="provider-api-key" v-model.trim="providerForm.apiKey" :disabled="formBusy" type="password" autocomplete="new-password" :placeholder="editingProvider?.apiKeyConfigured ? t('settings.providerApiKeyKeep', { preview: editingProvider.apiKeyPreview || '' }) : t('settings.providerApiKeyPlaceholder')" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          <label v-if="editingProvider?.apiKeyConfigured" class="mt-1.5 flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-2.5">
            <input id="provider-clear-api-key" v-model="providerForm.clearApiKey" :disabled="formBusy" type="checkbox" class="min-h-auto w-auto">
            <span class="text-[13px]">{{ t('settings.providerClearApiKey') }}</span>
          </label>
        </AdminField>
      </AdminSettingsGroup>
      <AdminSettingsGroup :title="t('settings.providerGroupModels')" :hint="t('settings.providerGroupModelsHint')">
        <AdminSettingsSection
          :title="providerForm.kind === 'chat' ? t('settings.providerChatModels') : t('settings.providerImageModels')"
          :hint="t('settings.providerModelHint') + (providerForm.kind === 'image' ? t('settings.providerImageDefaultHint') : '')"
          :empty="!providerForm.modelCatalog.length"
        >
          <template #actions>
            <Button type="button" variant="outline" size="sm" :disabled="formBusy" @click="addProviderModel"><Plus class="mr-1 h-4 w-4" />{{ t('settings.providerAddModel') }}</Button>
          </template>
        <div v-if="providerForm.modelCatalog.length" class="grid items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_32px]" :style="modelGridStyle">
          <span class="text-[11px] font-medium text-[var(--text-muted)]">{{ providerForm.kind === 'chat' ? t('settings.providerColumnChatModel') : t('settings.providerColumnImageModel') }}</span>
          <span v-if="providerForm.kind === 'image'" class="text-[11px] font-medium text-[var(--text-muted)]">{{ t('settings.providerColumnEditModel') }}</span>
          <span class="text-[11px] font-medium text-[var(--text-muted)]">{{ t('settings.providerColumnName') }}</span>
          <span v-if="providerForm.kind === 'image'" class="text-[11px] font-medium text-[var(--text-muted)]">{{ t('settings.providerColumnTransparent') }}</span>
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </div>
        <div v-for="(model, index) in providerForm.modelCatalog" :key="index" class="grid items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_32px]" :style="modelGridStyle">
          <input :id="`provider-model-id-${index}`" :disabled="formBusy" v-model.trim="model.id" :placeholder="index === 0 ? t('settings.providerModelIdExample', { example: providerForm.kind === 'chat' ? 'gpt-4o-mini' : 'gpt-image-2' }) : t('settings.providerModelId')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          <input v-if="providerForm.kind === 'image'" :id="`provider-model-edit-${index}`" :disabled="formBusy" v-model.trim="model.editModel" :placeholder="index === 0 ? t('settings.providerModelEditExample', { example: 'gpt-image-2' }) : t('settings.providerModelEdit')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          <input :id="`provider-model-name-${index}`" :disabled="formBusy" v-model.trim="model.name" :placeholder="index === 0 ? t('settings.providerModelNameExample', { example: providerForm.kind === 'chat' ? 'GPT-4o Mini' : 'GPT Image 2' }) : t('settings.providerModelName')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          <label v-if="providerForm.kind === 'image'" class="flex items-center gap-1 text-xs text-[var(--text-muted)]"><input :id="`provider-model-transparent-${index}`" :disabled="formBusy" v-model="model.supportsTransparent" type="checkbox" class="min-h-auto w-auto">{{ t('settings.providerModelTransparent') }}</label>
          <label class="flex items-center gap-1 text-xs text-[var(--text-muted)]"><input :disabled="formBusy" v-model="model.enabled" type="checkbox" class="min-h-auto w-auto">{{ t('common.enable') }}</label>
          <Button type="button" variant="ghost" size="icon" :disabled="providerForm.modelCatalog.length <= 1 || formBusy" :aria-label="t('settings.providerRemoveModelAria', { index: index + 1 })" :title="t('settings.providerRemoveModel')" @click="removeProviderModel(index)"><Trash2 class="h-4 w-4" /></Button>
        </div>
        <AdminField id="provider-edit-model" :label="t('settings.providerEditModel')" :hint="t('settings.providerEditModelHint')">
          <input id="provider-edit-model" v-model.trim="providerForm.editModel" :disabled="formBusy" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
        </AdminField>
        <span aria-hidden="true" />
      </AdminSettingsSection>
      </AdminSettingsGroup>

        <!-- 低频参数收进「高级」；主列只留真正会改的东西。 -->
        <AdminSettingsGroup :title="t('settings.providerGroupAdvanced')" :hint="t('settings.providerGroupAdvancedHint')" :default-open="false">
          <AdminField id="provider-priority" :label="t('settings.providerPriority')">
            <input id="provider-priority" v-model.number="providerForm.priority" :disabled="formBusy" type="number" min="0" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          </AdminField>
          <AdminField id="provider-timeout" :label="t('settings.providerTimeoutMs')">
            <input id="provider-timeout" v-model.number="providerForm.timeoutMs" :disabled="formBusy" type="number" min="0" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          </AdminField>
          <AdminField id="provider-retry" :label="t('settings.providerRetry')">
            <input id="provider-retry" v-model.number="providerForm.retryCount" :disabled="formBusy" type="number" min="0" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          </AdminField>
          <AdminField id="provider-compat-mode" :label="t('settings.providerCompatMode')" :class="providerForm.kind === 'image' ? '' : 'hidden'">
            <select id="provider-compat-mode" v-model="providerForm.imageCompatibilityMode" :disabled="formBusy" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
              <option value="auto">{{ t('settings.providerCompatAuto') }}</option>
              <option value="openai">{{ t('settings.providerCompatOpenai') }}</option>
              <option value="lucen">Lucen / sub2api OAuth</option>
            </select>
          </AdminField>
          <AdminField id="provider-notes" :label="t('common.note')">
            <input id="provider-notes" v-model.trim="providerForm.notes" :disabled="formBusy" class="min-h-8 w-full rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          </AdminField>
          <AdminField id="provider-enabled" :label="t('common.enable')">
            <label class="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-2.5"><input id="provider-enabled" v-model="providerForm.enabled" :disabled="formBusy" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">{{ t('common.enable') }}</span></label>
          </AdminField>
          <AdminField v-if="providerForm.kind === 'image'" id="provider-webp-refs" :label="t('settings.providerWebpRefs')">
            <label class="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-2.5"><input id="provider-webp-refs" v-model="providerForm.supportsWebpReferences" :disabled="formBusy" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">{{ t('settings.providerWebpRefs') }}</span></label>
          </AdminField>
        </AdminSettingsGroup>


        <!-- 保存按钮靠右收窄，与运行时配置一致。 -->
        <div class="flex items-center justify-end gap-3 border-t border-border py-3">
          <Button variant="outline" type="button" size="sm" :disabled="formBusy" @click="resetProviderForm(providerForm.kind)">{{ t('settings.providerReset') }}</Button>
          <Button type="submit" size="sm" :disabled="Boolean(providerActionId)">{{ providerActionId ? t('common.saving') : providerForm.id ? t('settings.providerSave') : t('settings.providerCreate') }}</Button>
        </div>
    </form>
    <p v-else class="mb-3 text-[13px] text-[var(--text-muted)]">{{ t('settings.noManagePermission') }}</p>
    <div class="mt-4 w-full overflow-x-auto rounded-md border border-border"><table class="w-full min-w-[760px] border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('settings.providerTable.kind'),t('settings.providerTable.name'),t('settings.providerTable.models'),t('settings.providerTable.compat'),t('settings.providerTable.key'),t('settings.providerTable.status'),t('settings.providerTable.actions')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="provider in providerRows" :key="provider.id" class="border-b border-border"><td class="px-3 py-2">{{ provider.kind }}</td><td class="px-3 py-2"><div class="font-semibold">{{ provider.name }}</div><div class="text-xs text-[var(--text-muted)]">{{ t('settings.providerPriority') }} {{ provider.priority }} · {{ provider.baseUrl }}</div></td><td class="px-3 py-2 text-xs"><div class="flex flex-col gap-0.5"><span v-for="(model, index) in providerModelCatalogRows(provider)" :key="`${model.id}-${index}`" :class="model.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] line-through'">{{ model.name || model.id }} <span class="text-[10px] text-[var(--text-muted)]">({{ model.id }})</span></span><span v-if="!providerModelCatalogRows(provider).length">{{ provider.defaultModel || provider.imageModel || '-' }}</span></div></td><td class="px-3 py-2 text-xs">{{ providerCompatibilityLabel(provider) }}</td><td class="px-3 py-2">{{ provider.apiKeyConfigured ? provider.apiKeyPreview || t('settings.providerApiKeyConfigured') : t('settings.providerApiKeyUnconfigured') }}</td><td class="px-3 py-2"><Badge :variant="provider.enabled && provider.apiKeyConfigured ? 'default' : 'secondary'">{{ providerStatusLabel(provider) }}</Badge></td><td class="px-3 py-2"><Button variant="ghost" size="sm" :disabled="provider.source !== 'database' || !props.canManage || formBusy" @click="editProvider(provider)">{{ t('common.edit') }}</Button></td></tr><tr v-if="!providerRows.length"><td colspan="7" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('settings.providerNoRows') }}</td></tr></tbody></table></div>
    <div class="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border"><div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">Image Providers</span><strong class="block text-xl">{{ imageProviderRows.length }}</strong></div><div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">Chat Providers</span><strong class="block text-xl">{{ chatProviderRows.length }}</strong></div></div>
    <ConfirmDialog
      v-model:open="confirm.open.value"
      :title="t('settings.confirmDeleteProviderTitle')"
      :description="t('settings.confirmDeleteProviderDetail')"
      :confirm-label="t('settings.confirmDeleteProviderAction')"
      destructive
      @confirm="confirm.confirm()"
    />
  </div>
</template>
