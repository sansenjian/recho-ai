<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AdminImageAttemptsPanel from './AdminImageAttemptsPanel.vue'
import { adminApiJson } from '../../composables/useAdminApi'
import { publicClientErrorMessage } from '../../lib/safe-error'
import type { AdminImageAttemptItem, AdminImageAttemptOverview } from '../../types/admin'

const attempts = ref<AdminImageAttemptItem[]>([])
const overview = ref<AdminImageAttemptOverview | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const statusFilter = ref('')
const userFilter = ref('')
const errorTypeFilter = ref('')
const httpStatusFilter = ref('')
const hoursFilter = ref('24')

async function refresh() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams({ limit: '40', hours: hoursFilter.value || '24' })
    if (statusFilter.value) params.set('status', statusFilter.value)
    if (userFilter.value.trim()) params.set('userId', userFilter.value.trim())
    if (errorTypeFilter.value.trim()) params.set('errorType', errorTypeFilter.value.trim())
    if (httpStatusFilter.value.trim()) params.set('httpStatus', httpStatusFilter.value.trim())
    const data = await adminApiJson<{ overview: AdminImageAttemptOverview; attempts: AdminImageAttemptItem[] }>(`/api/admin/image-attempts?${params}`)
    overview.value = data.overview
    attempts.value = data.attempts
  } catch (error) {
    errorMessage.value = publicClientErrorMessage(error, '生图监控加载失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <section class="flex flex-col gap-4">
    <p v-if="errorMessage" class="inline-flex min-h-8 items-center rounded-md bg-red-500/10 px-3 text-[13px] font-medium text-red-500" aria-live="polite">{{ errorMessage }}</p>
    <AdminImageAttemptsPanel v-model:status-filter="statusFilter" v-model:user-filter="userFilter" v-model:error-type-filter="errorTypeFilter" v-model:http-status-filter="httpStatusFilter" v-model:hours-filter="hoursFilter" :attempts="attempts" :overview="overview" :loading="loading" @refresh="refresh" />
  </section>
</template>
