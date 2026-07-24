<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { adminApiJson } from '../../composables/useAdminApi'
import { publicClientErrorMessage } from '../../lib/safe-error'
import type { AdminLedgerEntry, AdminOverview } from '../../types/admin'
import { dateTime, shortId } from '../../utils/admin-format'
import { formatCreditAmount, formatSignedCreditAmount } from '../../utils/credit-format'

const props = defineProps<{ refreshVersion?: number }>()
const { t } = useI18n()
const overview = ref<AdminOverview | null>(null)
const ledgerTransactions = ref<AdminLedgerEntry[]>([])
const overviewLoading = ref(false)
const ledgerLoading = ref(false)
const errorMessage = ref('')
const ledgerReason = ref('')
const ledgerHours = ref('168')
const ledgerUserId = ref('')
const loadedVersion = ref(-1)

const imageCostConfidenceLabel = computed(() => {
  const confidence = overview.value?.imageCost?.confidence || 'none'
  if (confidence === 'high') return t('overview.confidenceHigh')
  if (confidence === 'medium') return t('overview.confidenceMedium')
  if (confidence === 'low') return t('overview.confidenceLow')
  return t('overview.confidenceNone')
})
const overviewCodeHealth = computed(() => overview.value
  ? `${overview.value.codes.active} / ${overview.value.codes.total}`
  : '0 / 0')
const overviewNetChange = computed(() => {
  const recent = overview.value?.transactions.last7Days
  return recent ? recent.redeemedCredits + recent.refundedCredits + recent.adminAdjustedCredits - recent.spentCredits : 0
})
const overviewGeneratedAt = computed(() => overview.value
  ? `${t('overview.updatedAt')} ${dateTime(overview.value.generatedAt)}`
  : t('overview.waiting'))

function setError(error: unknown) {
  errorMessage.value = publicClientErrorMessage(error, '后台操作失败，请稍后重试。')
}
function creditAmount(value: unknown) { return formatCreditAmount(value) }
function signedCreditAmount(value: unknown) { return formatSignedCreditAmount(value) }
function transactionReason(reason: string) {
  const key = `credits.transactionReason.${reason}` as const
  const translated = t(key)
  return translated !== key ? translated : reason
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

async function refreshOverview() {
  if (overviewLoading.value) return
  overviewLoading.value = true
  errorMessage.value = ''
  try {
    const data = await adminApiJson<{ overview: AdminOverview }>('/api/admin/credits/overview')
    overview.value = data.overview
  } catch (error) {
    setError(error)
  } finally {
    overviewLoading.value = false
  }
}

async function refreshLedger() {
  if (ledgerLoading.value) return
  ledgerLoading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams({ limit: '50' })
    if (ledgerReason.value) query.set('reason', ledgerReason.value)
    if (ledgerHours.value) query.set('hours', ledgerHours.value)
    if (ledgerUserId.value.trim()) query.set('userId', ledgerUserId.value.trim())
    const data = await adminApiJson<{ transactions: AdminLedgerEntry[] }>(`/api/admin/credits/transactions?${query}`)
    ledgerTransactions.value = data.transactions
  } catch (error) {
    setError(error)
  } finally {
    ledgerLoading.value = false
  }
}

async function refreshPanel() {
  if (overviewLoading.value || ledgerLoading.value) return
  await Promise.all([refreshOverview(), refreshLedger()])
  loadedVersion.value = props.refreshVersion ?? 0
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
        <div><h2 class="text-sm font-semibold tracking-tight">{{ t('overview.title') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ overviewGeneratedAt }}</span></div>
        <Button variant="outline" size="sm" :disabled="overviewLoading" @click="refreshOverview">{{ t('common.refresh') }}</Button>
      </div>
      <div class="grid gap-px overflow-hidden rounded-md border border-border bg-border" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
        <div v-for="item in [
          { label: t('overview.totalBalance'), value: creditAmount(overview?.users.totalBalance) },
          { label: t('overview.totalRedeemed'), value: creditAmount(overview?.users.totalRedeemed) },
          { label: t('overview.totalSpent'), value: creditAmount(overview?.users.totalSpent) },
          { label: t('overview.imageCostPerImage'), value: creditAmount(overview?.settings.imageCreditCostPerImage ?? 1) },
          { label: t('overview.availableCodes'), value: overviewCodeHealth },
          { label: t('overview.redeemedCodeCredits'), value: creditAmount(overview?.codes.totalRedeemedCredits) },
          { label: t('overview.weeklyTxns'), value: overview?.transactions.last7Days.totalCount ?? 0 },
          { label: t('overview.weeklySpend'), value: creditAmount(overview?.transactions.last7Days.spentCredits) },
        ]" :key="item.label" class="bg-[var(--surface)] p-3">
          <span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ item.label }}</span>
          <strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-xl font-semibold">{{ item.value }}</strong>
        </div>
        <div class="bg-[var(--surface)] p-3">
          <span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ t('overview.weeklyNet') }}</span>
          <strong class="block overflow-hidden text-ellipsis whitespace-nowrap text-xl font-semibold" :class="overviewNetChange >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ signedCreditAmount(overviewNetChange) }}</strong>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div><h2 class="text-sm font-semibold">{{ t('overview.imageCost') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ t('overview.payAsYouGo') }} · {{ t('overview.confidence') }} {{ imageCostConfidenceLabel }}</span></div>
        <span class="whitespace-nowrap text-2xl font-semibold">¥{{ overview?.imageCost?.totalCostPerImage?.toFixed(4) ?? '0.0000' }}<small class="text-[13px] font-normal text-[var(--text-muted)]">{{ t('overview.imageCostUnit') }}</small></span>
      </div>
      <div class="grid gap-px overflow-hidden rounded-md border border-border bg-border" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
        <div v-for="item in [
          { label: t('overview.cosStoragePerImage'), value: `¥${overview?.imageCost?.cosStorageCostPerImage?.toFixed(4) ?? '0.0000'}` },
          { label: t('overview.cosTrafficPerImage'), value: `¥${overview?.imageCost?.cosTrafficCostPerImage?.toFixed(4) ?? '0.0000'}` },
          { label: t('overview.supabaseStoragePerImage'), value: `¥${overview?.imageCost?.supabaseStorageCostPerImage?.toFixed(4) ?? '0.0000'}` },
          { label: t('overview.supabaseTrafficPerImage'), value: `¥${overview?.imageCost?.supabaseTrafficCostPerImage?.toFixed(4) ?? '0.0000'}` },
          { label: t('overview.estimatedMonthlyCost'), value: `¥${overview?.imageCost?.estimatedMonthlyCost?.toFixed(2) ?? '0.00'}` },
          { label: t('overview.sampleCount'), value: `${overview?.imageCost?.cosImageCount ?? 0} COS / ${overview?.imageCost?.supabaseImageCount ?? 0} SB` },
        ]" :key="item.label" class="bg-[var(--surface)] p-3">
          <span class="mb-1 block text-[11px] font-medium uppercase text-[var(--text-muted)]">{{ item.label }}</span><strong class="block text-[15px] font-semibold">{{ item.value }}</strong>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div><h2 class="text-sm font-semibold">{{ t('credits.ledger.title') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ ledgerTransactions.length }}</span></div>
        <div class="flex flex-wrap items-center gap-1.5">
          <select v-model="ledgerReason" :disabled="ledgerLoading" class="min-h-8 min-w-[100px] rounded-md border border-border bg-[var(--surface)] px-2 text-[13px]" @change="refreshLedger"><option value="">{{ t('credits.ledger.allTypes') }}</option><option value="redemption">{{ t('credits.transactionReason.redemption') }}</option><option value="image_generation">{{ t('credits.transactionReason.image_generation') }}</option><option value="refund">{{ t('credits.transactionReason.refund') }}</option><option value="admin_adjustment">{{ t('credits.transactionReason.admin_adjustment') }}</option></select>
          <select v-model="ledgerHours" :disabled="ledgerLoading" class="min-h-8 min-w-[100px] rounded-md border border-border bg-[var(--surface)] px-2 text-[13px]" @change="refreshLedger"><option value="24">{{ t('credits.ledger.last24h') }}</option><option value="168">{{ t('credits.ledger.last7d') }}</option><option value="720">{{ t('credits.ledger.last30d') }}</option><option value="">{{ t('credits.ledger.allTime') }}</option></select>
          <input v-model="ledgerUserId" type="search" :placeholder="t('credits.ledger.userIdFilter')" :disabled="ledgerLoading" class="min-h-8 max-w-[140px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs" @keyup.enter="refreshLedger">
          <Button variant="outline" size="sm" :disabled="ledgerLoading" @click="refreshLedger">{{ t('common.refresh') }}</Button>
        </div>
      </div>
      <div class="w-full overflow-x-auto rounded-md border border-border">
        <table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('credits.table.time'),t('credits.table.user'),t('credits.table.type'),t('credits.table.change'),t('credits.table.balance'),t('credits.table.details'),t('credits.table.note')]" :key="heading" class="whitespace-nowrap border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody>
          <tr v-for="tx in ledgerTransactions" :key="tx.id" class="border-b border-border hover:bg-[var(--hover-bg)]"><td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(tx.createdAt) }}</td><td class="px-3 py-2">{{ tx.email || shortId(tx.userId) }}</td><td class="px-3 py-2"><Badge variant="secondary">{{ transactionReason(tx.reason) }}</Badge></td><td class="px-3 py-2 font-mono" :class="tx.amount >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ signedCreditAmount(tx.amount) }}</td><td class="px-3 py-2 font-mono">{{ creditAmount(tx.balanceAfter) }}</td><td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ ledgerDetails(tx) }}</td><td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ tx.note || '-' }}</td></tr>
          <tr v-if="!ledgerTransactions.length"><td colspan="7" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('common.noData') }}</td></tr>
        </tbody></table>
      </div>
    </div>
  </section>
</template>
