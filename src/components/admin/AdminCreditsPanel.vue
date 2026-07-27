<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { adminApiJson } from '../../composables/useAdminApi'
import { publicClientErrorMessage } from '../../lib/safe-error'
import type { AdminCode, AdminCodeRedemption, AdminTransaction, AdminUser } from '../../types/admin'
import { dateTime, shortId } from '../../utils/admin-format'
import { formatCreditAmount, formatSignedCreditAmount } from '../../utils/credit-format'

const emit = defineEmits<{ dataChanged: [source: 'credits'] }>()
const { t } = useI18n()
const loading = ref(false)
const actionLoading = ref(false)
const codeRedemptionsLoading = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const users = ref<AdminUser[]>([])
const selectedUser = ref<AdminUser | null>(null)
const transactions = ref<AdminTransaction[]>([])
const codes = ref<AdminCode[]>([])
const createdCodes = ref<AdminCode[]>([])
const selectedCode = ref<AdminCode | null>(null)
const codeRedemptions = ref<AdminCodeRedemption[]>([])
const userQuery = ref('')
const adjustAmount = ref(10)
const adjustNote = ref('')
const codeForm = ref({ prefix: 'RECHO', credits: 100, count: 10, maxRedemptions: 1, days: 30, note: '' })
let usersController: AbortController | null = null
let userDetailController: AbortController | null = null

const selectedUserTitle = computed(() => selectedUser.value?.email || (selectedUser.value ? shortId(selectedUser.value.userId) : t('credits.noUserSelected')))
const createdCsv = computed(() => {
  const rows = [
    ['code', 'credits', 'max_redemptions', 'expires_at', 'note', 'database_id'],
    ...createdCodes.value.map(code => [code.code || '', String(code.credits), String(code.maxRedemptions), code.expiresAt || '', code.note || '', code.id]),
  ]
  return rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n')
})

function setError(error: unknown, fallback = '后台操作失败，请稍后重试。') {
  if (error instanceof DOMException && error.name === 'AbortError') return
  errorMessage.value = publicClientErrorMessage(error, fallback)
}
function creditAmount(value: unknown) { return formatCreditAmount(value) }
function signedCreditAmount(value: unknown) { return formatSignedCreditAmount(value) }
function transactionReason(reason: string) {
  const key = `credits.transactionReason.${reason}` as const
  const translated = t(key)
  return translated !== key ? translated : reason
}
function transactionNote(tx: AdminTransaction) {
  const note = tx.metadata?.note
  return typeof note === 'string' && note.trim() ? note : '-'
}
function codeStatus(code: AdminCode) {
  if (code.disabledAt) return t('credits.codeStatus.disabled')
  if (code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now()) return t('credits.codeStatus.expired')
  if (code.redeemedCount >= code.maxRedemptions) return t('credits.codeStatus.exhausted')
  return t('credits.codeStatus.available')
}

async function refreshUsers() {
  usersController?.abort()
  usersController = new AbortController()
  loading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams({ limit: '50' })
    if (userQuery.value.trim()) query.set('query', userQuery.value.trim())
    const data = await adminApiJson<{ users: AdminUser[] }>(`/api/admin/credits/users?${query}`, { signal: usersController.signal })
    users.value = data.users
    if (!selectedUser.value && data.users[0]) await selectUser(data.users[0])
    else if (selectedUser.value) selectedUser.value = data.users.find(item => item.userId === selectedUser.value?.userId) || selectedUser.value
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
    const data = await adminApiJson<{ codes: AdminCode[] }>('/api/admin/credits/codes?limit=50')
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

async function selectUser(target: AdminUser) {
  userDetailController?.abort()
  userDetailController = new AbortController()
  selectedUser.value = target
  errorMessage.value = ''
  try {
    const data = await adminApiJson<{ user: AdminUser; transactions: AdminTransaction[] }>(
      `/api/admin/credits/users/${encodeURIComponent(target.userId)}?limit=30`,
      { signal: userDetailController.signal },
    )
    selectedUser.value = data.user
    transactions.value = data.transactions
  } catch (error) {
    setError(error)
  }
}

async function submitAdjustment() {
  if (!selectedUser.value || !adjustAmount.value) return
  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ user: AdminUser; transactions: AdminTransaction[] }>(
      `/api/admin/credits/users/${encodeURIComponent(selectedUser.value.userId)}/adjust`,
      { method: 'POST', body: JSON.stringify({ amount: Number(adjustAmount.value), note: adjustNote.value }) },
    )
    selectedUser.value = data.user
    transactions.value = data.transactions
    users.value = users.value.map(item => item.userId === data.user.userId ? data.user : item)
    adjustNote.value = ''
    noticeMessage.value = t('feedback.creditsAdjusted')
    emit('dataChanged', 'credits')
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
    const data = await adminApiJson<{ codes: AdminCode[] }>('/api/admin/credits/codes', {
      method: 'POST',
      body: JSON.stringify(codeForm.value),
    })
    createdCodes.value = data.codes
    noticeMessage.value = t('feedback.codesGenerated', { count: data.codes.length })
    await refreshCodes()
    emit('dataChanged', 'credits')
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
    const data = await adminApiJson<{ redemptions: AdminCodeRedemption[] }>(`/api/admin/credits/codes/${encodeURIComponent(code.id)}/redemptions?limit=50`)
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
    const data = await adminApiJson<{ code: AdminCode }>(`/api/admin/credits/codes/${encodeURIComponent(code.id)}`, {
      method: 'PATCH', body: JSON.stringify({ disabled }),
    })
    codes.value = codes.value.map(item => item.id === data.code.id ? data.code : item)
    if (selectedCode.value?.id === data.code.id) selectedCode.value = data.code
    noticeMessage.value = disabled ? t('feedback.codeDisabled') : t('feedback.codeRestored')
    emit('dataChanged', 'credits')
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function copyCreatedCsv() {
  try {
    await navigator.clipboard.writeText(createdCsv.value)
    noticeMessage.value = t('feedback.csvCopied')
  } catch (error) {
    setError(error, t('feedback.copyFailed'))
  }
}

function downloadCreatedCsv() {
  const blob = new Blob([`${createdCsv.value}\n`], { type: 'text/csv;charset=utf-8' })
  const downloadUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = `recho-credit-codes-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  link.click()
  URL.revokeObjectURL(downloadUrl)
}

onMounted(() => Promise.all([refreshUsers(), refreshCodes()]))
onBeforeUnmount(() => {
  usersController?.abort()
  userDetailController?.abort()
})
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="min-h-0" aria-live="polite">
      <p v-if="errorMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-red-500/10 px-3 text-[13px] font-medium text-red-500">{{ errorMessage }}</p>
      <p v-else-if="noticeMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-600">{{ noticeMessage }}</p>
    </div>
    <div class="grid grid-cols-[minmax(280px,380px)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
      <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">{{ t('credits.users') }}</h2><span class="text-xs text-[var(--text-muted)]">{{ users.length }}</span></div><Button variant="outline" size="sm" :disabled="loading" @click="refreshUsers">{{ t('common.refresh') }}</Button></div>
        <form class="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2" @submit.prevent="refreshUsers"><input v-model.trim="userQuery" type="search" :placeholder="t('credits.searchUsers')" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"><Button variant="outline" size="sm" type="submit" :disabled="loading">{{ t('common.search') }}</Button></form>
        <div class="flex max-h-[480px] flex-col gap-1 overflow-y-auto"><button v-for="item in users" :key="item.userId" class="flex min-h-[38px] w-full items-center justify-between gap-2 rounded-md border border-border bg-[var(--surface)] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--hover-bg)]" :class="{ 'border-primary bg-primary/5': selectedUser?.userId === item.userId }" @click="selectUser(item)"><span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ item.email || shortId(item.userId) }}</span><strong class="shrink-0 font-mono text-[13px]">{{ creditAmount(item.balance) }}</strong></button></div>
      </div>
      <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4"><h2 class="text-sm font-semibold">{{ t('credits.userDetail') }}</h2><span class="text-xs text-[var(--text-muted)]">{{ selectedUserTitle }}</span></div>
        <div v-if="selectedUser" class="mb-4 grid grid-cols-4 gap-px overflow-hidden rounded-md border border-border bg-border max-md:grid-cols-2"><div v-for="item in [{ label: t('credits.balance'), value: creditAmount(selectedUser.balance) },{ label: t('credits.totalRedeemed'), value: creditAmount(selectedUser.totalRedeemed) },{ label: t('credits.totalSpent'), value: creditAmount(selectedUser.totalSpent) },{ label: t('common.updatedAt'), value: dateTime(selectedUser.updatedAt) }]" :key="item.label" class="bg-[var(--surface)] p-3"><span class="text-[11px] text-[var(--text-muted)]">{{ item.label }}</span><strong class="block text-lg">{{ item.value }}</strong></div></div>
        <form class="mb-4 flex flex-wrap items-end gap-2" @submit.prevent="submitAdjustment"><input v-model.number="adjustAmount" type="number" class="min-h-[30px] max-w-[140px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"><input v-model.trim="adjustNote" :placeholder="t('credits.adjustNotePlaceholder')" class="min-h-[30px] max-w-[180px] rounded-md border border-border bg-[var(--surface)] px-2 text-xs"><Button type="submit" :disabled="actionLoading || !selectedUser || !adjustAmount">{{ t('common.submit') }}</Button></form>
        <div class="w-full overflow-x-auto rounded-md border border-border"><table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('credits.table.time'),t('credits.table.type'),t('credits.table.change'),t('credits.table.balance'),t('credits.table.note')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold">{{ heading }}</th></tr></thead><tbody><tr v-for="tx in transactions" :key="tx.id" class="border-b border-border"><td class="px-3 py-2 text-xs">{{ dateTime(tx.created_at) }}</td><td class="px-3 py-2"><Badge variant="secondary">{{ transactionReason(tx.reason) }}</Badge></td><td class="px-3 py-2 font-mono" :class="tx.amount >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ signedCreditAmount(tx.amount) }}</td><td class="px-3 py-2 font-mono">{{ creditAmount(tx.balance_after) }}</td><td class="px-3 py-2 text-xs">{{ transactionNote(tx) }}</td></tr><tr v-if="!transactions.length"><td colspan="5" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('common.noData') }}</td></tr></tbody></table></div>
      </div>
    </div>

    <div class="grid grid-cols-[minmax(280px,380px)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
      <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex justify-between"><h2 class="text-sm font-semibold">{{ t('credits.generateCodes') }}</h2><span class="text-xs text-[var(--text-muted)]">{{ codeForm.count }} {{ t('credits.codeCount') }}</span></div>
        <form class="mb-4 grid grid-cols-3 gap-2.5 max-md:grid-cols-1" @submit.prevent="createCodes"><label v-for="field in ['prefix','credits','count','maxRedemptions','days','note'] as const" :key="field" class="flex flex-col gap-1"><span class="text-xs text-[var(--text-muted)]">{{ field }}</span><input v-model="codeForm[field]" :type="field === 'prefix' || field === 'note' ? 'text' : 'number'" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label><div class="col-span-full"><Button type="submit" :disabled="actionLoading">{{ t('common.generate') }}</Button></div></form>
        <div v-if="createdCodes.length" class="border-t border-border pt-4"><div class="mb-2.5 flex gap-2"><strong>{{ t('credits.thisBatch') }}</strong><Button variant="ghost" size="sm" @click="copyCreatedCsv">{{ t('credits.copyCsv') }}</Button><Button variant="ghost" size="sm" @click="downloadCreatedCsv">{{ t('credits.downloadCsv') }}</Button></div><textarea :value="createdCsv" readonly rows="6" class="w-full rounded-md border border-border bg-[var(--surface)] p-2 font-mono text-xs" /></div>
      </div>
      <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
        <div class="mb-4 flex justify-between"><div><h2 class="text-sm font-semibold">{{ t('credits.codes') }}</h2><span class="text-xs text-[var(--text-muted)]">{{ codes.length }}</span></div><Button variant="outline" size="sm" :disabled="loading" @click="refreshCodes">{{ t('common.refresh') }}</Button></div>
        <div class="w-full overflow-x-auto rounded-md border border-border"><table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('credits.table.created'),t('credits.table.credits'),t('credits.table.usage'),t('credits.table.status'),t('credits.table.note'),t('credits.table.actions')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold">{{ heading }}</th></tr></thead><tbody><tr v-for="code in codes" :key="code.id" class="border-b border-border"><td class="px-3 py-2 text-xs">{{ dateTime(code.createdAt) }}</td><td class="px-3 py-2 font-mono">{{ code.credits }}</td><td class="px-3 py-2 font-mono">{{ code.redeemedCount }} / {{ code.maxRedemptions }}</td><td class="px-3 py-2"><Badge :variant="codeStatus(code) === t('credits.codeStatus.available') ? 'default' : 'destructive'">{{ codeStatus(code) }}</Badge></td><td class="px-3 py-2 text-xs">{{ code.note || '-' }}</td><td class="px-3 py-2"><div class="flex gap-1"><Button variant="ghost" size="sm" @click="viewCodeRedemptions(code)">{{ t('common.details') }}</Button><Button variant="ghost" size="sm" :disabled="actionLoading" @click="setCodeDisabled(code, !code.disabledAt)">{{ code.disabledAt ? t('common.restore') : t('common.disable') }}</Button></div></td></tr><tr v-if="!codes.length"><td colspan="6" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('common.noData') }}</td></tr></tbody></table></div>
        <div v-if="selectedCode" class="mt-4 border-t border-border pt-4"><div class="mb-2.5 flex items-center gap-2"><strong>{{ t('credits.codeRedemptions') }}</strong><span>{{ selectedCode.redeemedCount }} / {{ selectedCode.maxRedemptions }}</span><Button variant="ghost" size="sm" @click="viewCodeRedemptions(selectedCode)">{{ t('common.refresh') }}</Button></div><div class="overflow-x-auto rounded-md border border-border"><table class="w-full text-[13px]"><tbody><tr v-for="redemption in codeRedemptions" :key="redemption.id" class="border-b border-border"><td class="px-3 py-2">{{ dateTime(redemption.redeemedAt) }}</td><td class="px-3 py-2">{{ redemption.email || shortId(redemption.userId) }}</td><td class="px-3 py-2">{{ redemption.credits }}</td><td class="px-3 py-2">{{ redemption.balanceAfter ?? '-' }}</td></tr><tr v-if="!codeRedemptions.length"><td colspan="4" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ codeRedemptionsLoading ? t('common.loading') : t('common.noData') }}</td></tr></tbody></table></div></div>
      </div>
    </div>
  </section>
</template>
