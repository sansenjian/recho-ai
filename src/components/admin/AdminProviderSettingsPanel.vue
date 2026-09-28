<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2 } from '@lucide/vue'
import { adminApiJson } from '../../composables/useAdminApi'
import { adminErrorMessage } from '../../utils/admin-format'
import { providerModelCatalogRows } from '../../utils/admin-providers'
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
// Image rows grow a third input (the per-row edit model); chat rows keep the
// historical id + display-name pair. The header row reuses the same template so
// the labels stay aligned with the inputs.
const providerModelGridClass = computed(() => providerForm.value.kind === 'image'
  ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]'
  : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]')

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
    <form v-if="props.canManage" class="flex flex-col gap-3" @submit.prevent="saveProvider">
      <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.providerKind') }}</span><select id="provider-kind" v-model="providerForm.kind" :disabled="Boolean(providerForm.id) || formBusy" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]" @change="resetProviderForm(providerForm.kind)"><option value="image">Image</option><option value="chat">Chat</option></select></label>
      <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.providerName') }}</span><input id="provider-name" :disabled="formBusy" v-model.trim="providerForm.name" required class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
      <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">Base URL</span><input id="provider-base-url" :disabled="formBusy" v-model.trim="providerForm.baseUrl" type="url" required class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
      <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.providerApiKey') }}</span><input id="provider-api-key" :disabled="formBusy" v-model.trim="providerForm.apiKey" type="password" autocomplete="new-password" :placeholder="editingProvider?.apiKeyConfigured ? t('settings.providerApiKeyKeep', { preview: editingProvider.apiKeyPreview || '' }) : t('settings.providerApiKeyPlaceholder')" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
      <label v-if="editingProvider?.apiKeyConfigured" class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3"><input id="provider-clear-api-key" :disabled="formBusy" v-model="providerForm.clearApiKey" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">{{ t('settings.providerClearApiKey') }}</span></label>
      <div class="grid grid-cols-3 gap-2 max-md:grid-cols-1"><label v-for="field in ['priority','timeoutMs','retryCount'] as const" :key="field" class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ field === 'priority' ? t('settings.providerPriority') : field === 'timeoutMs' ? t('settings.providerTimeoutMs') : t('settings.providerRetry') }}</span><input :id="`provider-${field}`" :disabled="formBusy" v-model.number="providerForm[field]" type="number" min="0" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label></div>
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between"><span class="text-xs text-[var(--text-muted)]">{{ providerForm.kind === 'chat' ? t('settings.providerChatModels') : t('settings.providerImageModels') }}</span><Button type="button" variant="outline" size="sm" :disabled="formBusy" @click="addProviderModel"><Plus class="mr-1 h-4 w-4" />{{ t('settings.providerAddModel') }}</Button></div>
        <div v-if="providerForm.modelCatalog.length" class="grid gap-2" :class="providerModelGridClass">
          <span class="text-[11px] font-medium text-[var(--text-muted)]">{{ providerForm.kind === 'chat' ? t('settings.providerColumnChatModel') : t('settings.providerColumnImageModel') }}</span>
          <span v-if="providerForm.kind === 'image'" class="text-[11px] font-medium text-[var(--text-muted)]">{{ t('settings.providerColumnEditModel') }}</span>
          <span class="text-[11px] font-medium text-[var(--text-muted)]">{{ t('settings.providerColumnName') }}</span>
          <span v-if="providerForm.kind === 'image'" class="text-[11px] font-medium text-[var(--text-muted)]">{{ t('settings.providerColumnTransparent') }}</span>
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </div>
        <div v-for="(model, index) in providerForm.modelCatalog" :key="index" class="grid items-center gap-2" :class="providerModelGridClass">
          <input :id="`provider-model-id-${index}`" :disabled="formBusy" v-model.trim="model.id" :placeholder="index === 0 ? t('settings.providerModelIdExample', { example: providerForm.kind === 'chat' ? 'gpt-4o-mini' : 'gpt-image-2' }) : t('settings.providerModelId')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          <input v-if="providerForm.kind === 'image'" :id="`provider-model-edit-${index}`" :disabled="formBusy" v-model.trim="model.editModel" :placeholder="index === 0 ? t('settings.providerModelEditExample', { example: 'gpt-image-2' }) : t('settings.providerModelEdit')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          <input :id="`provider-model-name-${index}`" :disabled="formBusy" v-model.trim="model.name" :placeholder="index === 0 ? t('settings.providerModelNameExample', { example: providerForm.kind === 'chat' ? 'GPT-4o Mini' : 'GPT Image 2' }) : t('settings.providerModelName')" class="min-h-8 min-w-0 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
          <label v-if="providerForm.kind === 'image'" class="flex items-center gap-1 text-xs text-[var(--text-muted)]"><input :id="`provider-model-transparent-${index}`" :disabled="formBusy" v-model="model.supportsTransparent" type="checkbox" class="min-h-auto w-auto">{{ t('settings.providerModelTransparent') }}</label>
          <label class="flex items-center gap-1 text-xs text-[var(--text-muted)]"><input :disabled="formBusy" v-model="model.enabled" type="checkbox" class="min-h-auto w-auto">{{ t('common.enable') }}</label>
          <Button type="button" variant="ghost" size="icon" :disabled="providerForm.modelCatalog.length <= 1 || formBusy" :aria-label="t('settings.providerRemoveModelAria', { index: index + 1 })" :title="t('settings.providerRemoveModel')" @click="removeProviderModel(index)"><Trash2 class="h-4 w-4" /></Button>
        </div>
        <span class="text-[11px] text-[var(--text-muted)]">{{ t('settings.providerModelHint') }}{{ providerForm.kind === 'image' ? t('settings.providerImageDefaultHint') : '' }}</span>
      </div>
      <template v-if="providerForm.kind === 'image'">
        <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.providerEditModel') }}</span><input id="provider-edit-model" :disabled="formBusy" v-model.trim="providerForm.editModel" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
        <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('settings.providerCompatMode') }}</span><select id="provider-compat-mode" :disabled="formBusy" v-model="providerForm.imageCompatibilityMode" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"><option value="auto">{{ t('settings.providerCompatAuto') }}</option><option value="openai">{{ t('settings.providerCompatOpenai') }}</option><option value="lucen">Lucen / sub2api OAuth</option></select></label>
        <label class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3"><input id="provider-webp-refs" :disabled="formBusy" v-model="providerForm.supportsWebpReferences" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">{{ t('settings.providerWebpRefs') }}</span></label>
      </template>
      <label class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ t('common.note') }}</span><input id="provider-notes" :disabled="formBusy" v-model.trim="providerForm.notes" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label>
      <label class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-[var(--bubble-bg)] px-3"><input id="provider-enabled" :disabled="formBusy" v-model="providerForm.enabled" type="checkbox" class="min-h-auto w-auto"><span class="text-[13px]">{{ t('common.enable') }}</span></label>
      <div class="flex flex-wrap gap-2"><Button type="submit" :disabled="Boolean(providerActionId)">{{ providerActionId ? t('common.saving') : providerForm.id ? t('settings.providerSave') : t('settings.providerCreate') }}</Button><Button variant="outline" type="button" :disabled="formBusy" @click="resetProviderForm(providerForm.kind)">{{ t('settings.providerReset') }}</Button></div>
    </form>
    <p v-else class="mb-3 text-[13px] text-[var(--text-muted)]">{{ t('settings.noManagePermission') }}</p>
    <div class="mt-4 w-full overflow-x-auto rounded-md border border-border"><table class="w-full min-w-[760px] border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('settings.providerTable.kind'),t('settings.providerTable.name'),t('settings.providerTable.models'),t('settings.providerTable.compat'),t('settings.providerTable.key'),t('settings.providerTable.status'),t('settings.providerTable.actions')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="provider in providerRows" :key="provider.id" class="border-b border-border"><td class="px-3 py-2">{{ provider.kind }}</td><td class="px-3 py-2"><div class="font-semibold">{{ provider.name }}</div><div class="text-xs text-[var(--text-muted)]">{{ t('settings.providerPriority') }} {{ provider.priority }} · {{ provider.baseUrl }}</div></td><td class="px-3 py-2 text-xs"><div class="flex flex-col gap-0.5"><span v-for="(model, index) in providerModelCatalogRows(provider)" :key="`${model.id}-${index}`" :class="model.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] line-through'">{{ model.name || model.id }} <span class="text-[10px] text-[var(--text-muted)]">({{ model.id }})</span></span><span v-if="!providerModelCatalogRows(provider).length">{{ provider.defaultModel || provider.imageModel || '-' }}</span></div></td><td class="px-3 py-2 text-xs">{{ providerCompatibilityLabel(provider) }}</td><td class="px-3 py-2">{{ provider.apiKeyConfigured ? provider.apiKeyPreview || t('settings.providerApiKeyConfigured') : t('settings.providerApiKeyUnconfigured') }}</td><td class="px-3 py-2"><Badge :variant="provider.enabled && provider.apiKeyConfigured ? 'default' : 'secondary'">{{ providerStatusLabel(provider) }}</Badge></td><td class="px-3 py-2"><Button variant="ghost" size="sm" :disabled="provider.source !== 'database' || !props.canManage || formBusy" @click="editProvider(provider)">{{ t('common.edit') }}</Button></td></tr><tr v-if="!providerRows.length"><td colspan="7" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('settings.providerNoRows') }}</td></tr></tbody></table></div>
    <div class="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border"><div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">Image Providers</span><strong class="block text-xl">{{ imageProviderRows.length }}</strong></div><div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">Chat Providers</span><strong class="block text-xl">{{ chatProviderRows.length }}</strong></div></div>
  </div>
</template>
