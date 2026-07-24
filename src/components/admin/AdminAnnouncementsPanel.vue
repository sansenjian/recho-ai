<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { adminApiJson } from '../../composables/useAdminApi'
import { publicClientErrorMessage } from '../../lib/safe-error'
import type { AdminAnnouncement } from '../../types/admin'
import { dateTime } from '../../utils/admin-format'

const emit = defineEmits<{ dataChanged: [source: 'announcements'] }>()
const { t } = useI18n()
const announcements = ref<AdminAnnouncement[]>([])
const loading = ref(false)
const actionLoading = ref(false)
const actionId = ref<string | null>(null)
const errorMessage = ref('')
const noticeMessage = ref('')
const form = ref({ title: '', body: '' })

function setError(error: unknown) { errorMessage.value = publicClientErrorMessage(error, '公告操作失败，请稍后重试。') }
function statusLabel(status: AdminAnnouncement['status']) {
  if (status === 'published') return t('announcements.statusPublished')
  if (status === 'archived') return t('announcements.statusArchived')
  return t('announcements.statusDraft')
}
async function refresh() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await adminApiJson<{ announcements: AdminAnnouncement[] }>('/api/admin/announcements')
    announcements.value = data.announcements
  } catch (error) { setError(error) } finally { loading.value = false }
}
async function createAnnouncement() {
  if (!form.value.title.trim() || !form.value.body.trim()) return
  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ announcement: AdminAnnouncement }>('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ ...form.value, status: 'published' }),
    })
    announcements.value = [data.announcement, ...announcements.value.filter(item => item.id !== data.announcement.id)]
    form.value = { title: '', body: '' }
    noticeMessage.value = t('announcements.published')
    emit('dataChanged', 'announcements')
  } catch (error) { setError(error) } finally { actionLoading.value = false }
}
async function setStatus(announcement: AdminAnnouncement, status: AdminAnnouncement['status']) {
  actionId.value = announcement.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ announcement: AdminAnnouncement }>(`/api/admin/announcements/${encodeURIComponent(announcement.id)}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    })
    announcements.value = announcements.value.map(item => item.id === data.announcement.id ? data.announcement : item)
    noticeMessage.value = status === 'published' ? t('announcements.published') : t('announcements.archived')
    emit('dataChanged', 'announcements')
  } catch (error) { setError(error) } finally { actionId.value = null }
}

onMounted(refresh)
</script>

<template>
  <section class="flex flex-col gap-4">
    <div aria-live="polite"><p v-if="errorMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-red-500/10 px-3 text-[13px] font-medium text-red-500">{{ errorMessage }}</p><p v-else-if="noticeMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-600">{{ noticeMessage }}</p></div>
    <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-sm font-semibold">{{ t('announcements.title') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ announcements.length }}</span></div><Button variant="outline" size="sm" :disabled="loading" @click="refresh">{{ t('common.refresh') }}</Button></div>
      <form class="mb-4 flex flex-col gap-2.5 border-b border-border pb-4" @submit.prevent="createAnnouncement"><label class="flex flex-col gap-1"><span class="text-xs font-medium text-[var(--text-muted)]">{{ t('announcements.titleLabel') }}</span><input v-model.trim="form.title" maxlength="120" required class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]"></label><label class="flex flex-col gap-1"><span class="text-xs font-medium text-[var(--text-muted)]">{{ t('announcements.bodyLabel') }}</span><textarea v-model.trim="form.body" rows="4" maxlength="4000" required class="rounded-md border border-border bg-[var(--surface)] px-2.5 py-1 text-xs font-mono" /></label><Button type="submit" :disabled="actionLoading">{{ t('announcements.publishBtn') }}</Button></form>
      <div class="w-full overflow-x-auto rounded-md border border-border"><table class="w-full border-collapse text-[13px]"><thead><tr><th v-for="heading in [t('announcements.table.updated'),t('announcements.table.status'),t('announcements.table.title'),t('announcements.table.body'),t('announcements.table.actions')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th></tr></thead><tbody><tr v-for="announcement in announcements" :key="announcement.id" class="border-b border-border"><td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(announcement.updatedAt) }}</td><td class="px-3 py-2"><Badge :variant="announcement.status === 'published' ? 'default' : 'secondary'">{{ statusLabel(announcement.status) }}</Badge></td><td class="px-3 py-2 font-semibold">{{ announcement.title }}</td><td class="max-w-[400px] whitespace-pre-wrap px-3 py-2 text-xs text-[var(--text-secondary)]">{{ announcement.body }}</td><td class="px-3 py-2"><div class="flex flex-wrap gap-1"><Button v-if="announcement.status !== 'published'" variant="ghost" size="sm" :disabled="actionId === announcement.id" @click="setStatus(announcement, 'published')">{{ t('common.publish') }}</Button><Button v-if="announcement.status !== 'archived'" variant="ghost" size="sm" :disabled="actionId === announcement.id" @click="setStatus(announcement, 'archived')">{{ t('common.archive') }}</Button></div></td></tr><tr v-if="!announcements.length"><td colspan="5" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('common.noData') }}</td></tr></tbody></table></div>
    </div>
  </section>
</template>
