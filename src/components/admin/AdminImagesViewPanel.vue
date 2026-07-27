<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import AdminImagesPanel from './AdminImagesPanel.vue'
import { adminApiJson } from '../../composables/useAdminApi'
import { publicClientErrorMessage } from '../../lib/safe-error'
import type { AdminImageItem, AdminImageStorageOverview, AdminImageStorageStat } from '../../types/admin'
import { formatCreditAmount } from '../../utils/credit-format'

const props = defineProps<{ adminMode: 'visual' | 'manage' }>()
const emit = defineEmits<{ dataChanged: [source: 'images'] }>()
const { t } = useI18n()
const images = ref<AdminImageItem[]>([])
const storageOverview = ref<AdminImageStorageOverview | null>(null)
const imagesLoading = ref(false)
const storageLoading = ref(false)
const bulkLoading = ref(false)
const actionId = ref<string | null>(null)
const selectedIds = ref<string[]>([])
const visibilityFilter = ref('')
const fundingFilter = ref('')
const userFilter = ref('')
const query = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')

function setError(error: unknown) { errorMessage.value = publicClientErrorMessage(error, '作品管理操作失败，请稍后重试。') }
function formatByteSize(bytes: number) {
  if (!bytes || bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  return `${(bytes / 1024 ** 3).toFixed(3)} GB`
}
function storageLocationLabel(location: AdminImageStorageStat['location']) {
  if (location === 'cos') return t('images.cos')
  if (location === 'supabase') return t('images.supabase')
  if (location === 'data') return t('images.data')
  return t('images.unknown')
}
function applyUpdates(updated: AdminImageItem[]) {
  const byId = new Map(updated.map(image => [image.id, image]))
  const next = images.value.map(image => byId.get(image.id) || image)
  images.value = visibilityFilter.value ? next.filter(image => image.visibility === visibilityFilter.value) : next
  const visibleIds = new Set(images.value.map(image => image.id))
  selectedIds.value = selectedIds.value.filter(id => visibleIds.has(id))
}
async function refreshImages() {
  if (imagesLoading.value) return
  imagesLoading.value = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams({ limit: '24' })
    if (visibilityFilter.value) params.set('visibility', visibilityFilter.value)
    if (fundingFilter.value) params.set('fundingSource', fundingFilter.value)
    if (userFilter.value.trim()) params.set('userId', userFilter.value.trim())
    if (query.value.trim()) params.set('query', query.value.trim())
    const data = await adminApiJson<{ images: AdminImageItem[] }>(`/api/admin/images?${params}`)
    images.value = data.images
    const visibleIds = new Set(data.images.map(image => image.id))
    selectedIds.value = selectedIds.value.filter(id => visibleIds.has(id))
  } catch (error) { setError(error) } finally { imagesLoading.value = false }
}
async function refreshStorage() {
  if (storageLoading.value) return
  storageLoading.value = true
  errorMessage.value = ''
  try {
    const data = await adminApiJson<{ overview: AdminImageStorageOverview }>('/api/admin/images/storage-overview')
    storageOverview.value = data.overview
  } catch (error) { setError(error) } finally { storageLoading.value = false }
}
async function setVisibility(image: AdminImageItem, visibility: AdminImageItem['visibility']) {
  if (props.adminMode !== 'manage' || (visibility === 'public' && image.fundingSource === 'credit')) return
  if (visibility === 'private' && !window.confirm(t('images.confirmHide'))) return
  actionId.value = image.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ image: AdminImageItem }>(`/api/admin/images/${encodeURIComponent(image.id)}/visibility`, { method: 'PATCH', body: JSON.stringify({ visibility }) })
    applyUpdates([data.image])
    noticeMessage.value = visibility === 'private' ? t('images.hidden') : t('images.restored')
  } catch (error) { setError(error) } finally { actionId.value = null }
}
async function bulkArchive() {
  if (props.adminMode !== 'manage' || !selectedIds.value.length || !window.confirm(t('images.confirmArchive', { count: selectedIds.value.length }))) return
  bulkLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ images: AdminImageItem[] }>('/api/admin/images/bulk/archive', { method: 'POST', body: JSON.stringify({ ids: selectedIds.value }) })
    applyUpdates(data.images)
    noticeMessage.value = `${t('images.archived')} ${data.images.length}`
    emit('dataChanged', 'images')
  } catch (error) { setError(error) } finally { bulkLoading.value = false }
}
async function bulkDelete() {
  if (props.adminMode !== 'manage' || !selectedIds.value.length || !window.confirm(t('images.confirmDelete', { count: selectedIds.value.length }))) return
  bulkLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  const requestedIds = [...selectedIds.value]
  try {
    const data = await adminApiJson<{ deletedIds: string[]; deletedCount: number }>('/api/admin/images/bulk/delete', { method: 'POST', body: JSON.stringify({ ids: requestedIds }) })
    const deleted = new Set(data.deletedIds.length ? data.deletedIds : requestedIds)
    images.value = images.value.filter(image => !deleted.has(image.id))
    selectedIds.value = []
    noticeMessage.value = `${t('images.deleted')} ${data.deletedCount}`
    await refreshStorage()
    emit('dataChanged', 'images')
  } catch (error) { setError(error) } finally { bulkLoading.value = false }
}

onMounted(() => Promise.all([refreshImages(), refreshStorage()]))
</script>

<template>
  <section class="flex flex-col gap-4">
    <div aria-live="polite"><p v-if="errorMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-red-500/10 px-3 text-[13px] font-medium text-red-500">{{ errorMessage }}</p><p v-else-if="noticeMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-600">{{ noticeMessage }}</p></div>
    <AdminImagesPanel v-model:selected-ids="selectedIds" v-model:visibility-filter="visibilityFilter" v-model:funding-filter="fundingFilter" v-model:user-filter="userFilter" v-model:query="query" :images="images" :loading="imagesLoading" :bulk-loading="bulkLoading" :action-id="actionId" @refresh="refreshImages" @set-visibility="setVisibility" @bulk-archive="bulkArchive" @bulk-delete="bulkDelete" />
    <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">{{ t('images.storageOverview') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ storageOverview ? `${storageOverview.totalImages} ${t('images.imageCount')} / ${formatByteSize(storageOverview.totalBytes)}` : t('common.loading') }}</span></div><Button variant="outline" size="sm" :disabled="storageLoading" @click="refreshStorage">{{ t('common.refresh') }}</Button></div>
      <div v-if="storageLoading" class="p-6 text-center text-[var(--text-muted)]">{{ t('images.statistics') }}</div>
      <div v-else-if="storageOverview" class="w-full overflow-x-auto rounded-md border border-border"><table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('images.storageLocation'),t('images.imageCount'),t('images.totalSize'),t('images.avgSize'),t('images.totalCredits'),t('images.sizePercent')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="stat in storageOverview.byLocation" :key="stat.location" class="border-b border-border"><td class="px-3 py-2">{{ storageLocationLabel(stat.location) }}</td><td class="px-3 py-2 font-mono">{{ stat.imageCount }}</td><td class="px-3 py-2 font-mono">{{ formatByteSize(stat.totalBytes) }}</td><td class="px-3 py-2 font-mono">{{ formatByteSize(stat.averageBytes) }}</td><td class="px-3 py-2 font-mono">{{ formatCreditAmount(stat.totalCreditCost) }}</td><td class="px-3 py-2">{{ storageOverview.totalBytes > 0 ? `${(stat.totalBytes / storageOverview.totalBytes * 100).toFixed(1)}%` : '0%' }}</td></tr></tbody></table></div>
    </div>
  </section>
</template>
