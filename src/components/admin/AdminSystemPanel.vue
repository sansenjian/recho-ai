<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { adminApiJson } from '../../composables/useAdminApi'
import { publicClientErrorMessage } from '../../lib/safe-error'
import type { AdminOverview, AdminSystemStatus } from '../../types/admin'
import { dateTime, tableStatusLabel } from '../../utils/admin-format'

const props = defineProps<{ refreshVersion?: number }>()
const { t } = useI18n()
const systemStatus = ref<AdminSystemStatus | null>(null)
const overview = ref<AdminOverview | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const loadedVersion = ref(-1)

const generatedAt = computed(() => systemStatus.value
  ? `${t('system.checkedAt')} ${dateTime(systemStatus.value.generatedAt)}`
  : t('system.waiting'))
const statusLabel = computed(() => {
  if (!systemStatus.value) return t('system.statusPending')
  if (systemStatus.value.status === 'ok') return t('system.statusOk')
  if (systemStatus.value.status === 'warning') return t('system.statusWarning')
  return t('system.statusError')
})
const confidenceLabel = computed(() => {
  const confidence = overview.value?.imageCost?.confidence || 'none'
  if (confidence === 'high') return t('overview.confidenceHigh')
  if (confidence === 'medium') return t('overview.confidenceMedium')
  if (confidence === 'low') return t('overview.confidenceLow')
  return t('overview.confidenceNone')
})

async function refreshPanel() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const [systemData, overviewData] = await Promise.all([
      adminApiJson<{ system: AdminSystemStatus }>('/api/admin/system'),
      adminApiJson<{ overview: AdminOverview }>('/api/admin/credits/overview'),
    ])
    systemStatus.value = systemData.system
    overview.value = overviewData.overview
    loadedVersion.value = props.refreshVersion ?? 0
  } catch (error) {
    errorMessage.value = publicClientErrorMessage(error, '系统状态加载失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

onMounted(refreshPanel)
onActivated(() => {
  if (loadedVersion.value !== (props.refreshVersion ?? 0)) void refreshPanel()
})
</script>

<template>
  <section class="flex flex-col gap-4">
    <p v-if="errorMessage" class="inline-flex min-h-8 items-center rounded-md bg-red-500/10 px-3 text-[13px] font-medium text-red-500" aria-live="polite">{{ errorMessage }}</p>
    <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div><h2 class="text-sm font-semibold">{{ t('system.title') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ generatedAt }}</span></div>
        <div class="flex items-center gap-2"><Badge :variant="systemStatus?.status === 'ok' ? 'default' : 'destructive'">{{ statusLabel }}</Badge><Button variant="outline" size="sm" :disabled="loading" @click="refreshPanel">{{ t('common.refresh') }}</Button></div>
      </div>
      <div class="grid grid-cols-5 gap-px overflow-hidden rounded-md border border-border bg-border max-xl:grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1">
        <div class="bg-[var(--surface)] p-3"><span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ t('system.supabaseBackend') }}</span><strong class="block text-[15px]" :class="systemStatus?.config.supabase.adminConfigured ? 'text-emerald-600' : 'text-red-500'">{{ systemStatus ? (systemStatus.config.supabase.adminConfigured ? t('system.ready') : t('system.notReady')) : '-' }}</strong></div>
        <div class="bg-[var(--surface)] p-3"><span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ t('system.imageService') }}</span><strong class="block text-[15px]" :class="systemStatus?.config.imageGeneration.apiKeyConfigured ? 'text-emerald-600' : 'text-red-500'">{{ systemStatus ? (systemStatus.config.imageGeneration.apiKeyConfigured ? t('system.ready') : t('system.notReady')) : '-' }}</strong></div>
        <div class="bg-[var(--surface)] p-3"><span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ t('system.adminRules') }}</span><strong class="block text-[15px]">{{ systemStatus ? systemStatus.config.adminUsers.databaseCount + systemStatus.config.adminUsers.envUserIdCount + systemStatus.config.adminUsers.envEmailCount : '-' }}</strong></div>
        <div class="bg-[var(--surface)] p-3"><span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ t('system.imageMonitor') }}</span><strong class="block text-[15px]">{{ systemStatus ? (systemStatus.config.imageGeneration.analyticsEnabled ? t('system.enabled') : t('system.disabled')) : '-' }}</strong></div>
        <div class="bg-[var(--surface)] p-3"><span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ t('system.imageCostPerImage') }}</span><strong class="block text-[15px]">{{ systemStatus?.config.imageGeneration.creditCostPerImage ?? 1 }}</strong></div>
      </div>

      <div class="my-4 h-px bg-border" />
      <h3 class="mb-2.5 text-xs font-semibold uppercase text-[var(--text-muted)]">{{ t('system.storageStats') }}</h3>
      <div class="grid grid-cols-4 gap-px overflow-hidden rounded-md border border-border bg-border max-md:grid-cols-2 max-sm:grid-cols-1">
        <div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">{{ t('system.cosStorage') }}</span><strong class="block text-[15px]">{{ overview?.imageCost?.cosImageCount ?? 0 }} 张</strong><span class="text-[11px] text-[var(--text-muted)]">{{ t('system.avgPerImage') }} {{ (overview?.imageCost?.averageStoredMb ?? 0).toFixed(2) }} MB</span></div>
        <div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">{{ t('system.supabaseStorage') }}</span><strong class="block text-[15px]">{{ overview?.imageCost?.supabaseImageCount ?? 0 }} 张</strong><span class="text-[11px] text-[var(--text-muted)]">{{ t('system.sampleDays') }} {{ overview?.imageCost?.sampleDays ?? 0 }} 天</span></div>
        <div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">{{ t('system.estimatedMonthlyCost') }}</span><strong class="block text-[15px]">¥{{ overview?.imageCost?.estimatedMonthlyCost?.toFixed(2) ?? '0.00' }}</strong><span class="text-[11px] text-[var(--text-muted)]">{{ t('overview.confidence') }} {{ confidenceLabel }}</span></div>
        <div class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">{{ t('system.totalImages') }}</span><strong class="block text-[15px]">{{ (overview?.imageCost?.cosImageCount ?? 0) + (overview?.imageCost?.supabaseImageCount ?? 0) }} 张</strong><span class="text-[11px] text-[var(--text-muted)]">¥{{ overview?.imageCost?.totalCostPerImage?.toFixed(4) ?? '0.0000' }}/张</span></div>
      </div>

      <div class="my-4 h-px bg-border" />
      <h3 class="mb-2.5 text-xs font-semibold uppercase text-[var(--text-muted)]">{{ t('system.warnings') }}</h3>
      <div class="mb-4 flex flex-wrap gap-1.5"><span v-for="warning in systemStatus?.warnings || []" :key="warning" class="inline-flex min-h-[26px] items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 text-xs text-amber-600">{{ warning }}</span><span v-if="systemStatus && !systemStatus.warnings.length" class="inline-flex min-h-[26px] items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 text-xs text-emerald-600">{{ t('system.noWarnings') }}</span><span v-else-if="!systemStatus" class="inline-flex min-h-[26px] items-center rounded-md bg-amber-500/10 px-2.5 text-xs text-amber-600">{{ t('system.waitingCheck') }}</span></div>
      <div class="w-full overflow-x-auto rounded-md border border-border"><table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('system.table.module'),t('system.table.status'),t('system.table.records'),t('system.table.message')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="table in systemStatus?.data.tables || []" :key="table.key" class="border-b border-border"><td class="px-3 py-2">{{ table.label }}</td><td class="px-3 py-2" :class="table.status === 'ok' ? 'text-emerald-600' : 'text-red-500'">{{ tableStatusLabel(table.status) }}</td><td class="px-3 py-2 font-mono">{{ table.count ?? '-' }}</td><td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ table.message }}</td></tr><tr v-if="!(systemStatus?.data.tables || []).length"><td colspan="4" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('system.noResults') }}</td></tr></tbody></table></div>
    </div>
  </section>
</template>
