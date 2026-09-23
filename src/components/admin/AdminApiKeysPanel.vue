<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { adminApiJson } from '../../composables/useAdminApi'
import { adminErrorMessage, dateTime } from '../../utils/admin-format'

interface ApiKeyItem {
  id: string
  name: string
  key_hint: string
  enabled: boolean
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

const { t } = useI18n()
const keys = ref<ApiKeyItem[]>([])
const loading = ref(false)
const actionLoading = ref(false)
const actionId = ref<string | null>(null)
const errorMessage = ref('')
const noticeMessage = ref('')
const keyName = ref('')
const shownKey = ref<{ plain: string; hint: string } | null>(null)
const copied = ref(false)

function setError(error: unknown) { errorMessage.value = adminErrorMessage(error, t('apikeys.createFailed')) }

async function refresh() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await adminApiJson<{ keys: ApiKeyItem[] }>('/api/admin/api-keys')
    keys.value = data.keys
  } catch (error) { setError(error) } finally { loading.value = false }
}

async function createKey() {
  if (!keyName.value.trim()) return
  actionLoading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ id: string; name: string; hint: string; key: string }>('/api/admin/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: keyName.value.trim() }),
    })
    shownKey.value = { plain: data.key, hint: data.hint }
    keyName.value = ''
    await refresh()
  } catch (error) { setError(error) } finally { actionLoading.value = false }
}

async function revoke(item: ApiKeyItem) {
  actionId.value = item.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await adminApiJson<{ ok: boolean }>(`/api/admin/api-keys/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
    if (data.ok) {
      keys.value = keys.value.map(k => k.id === item.id ? { ...k, revoked_at: new Date().toISOString() } : k)
      noticeMessage.value = t('apikeys.revokedNotice')
    }
  } catch (error) { setError(error) } finally { actionId.value = null }
}

async function copyKey() {
  if (!shownKey.value) return
  try {
    await navigator.clipboard.writeText(shownKey.value.plain)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // 剪贴板不可用时保持模态框,用户可手动选择复制
  }
}

onMounted(refresh)
</script>

<template>
  <section class="flex flex-col gap-4">
    <div aria-live="polite">
      <p v-if="errorMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-danger/10 px-3 text-[13px] font-medium text-danger">{{ errorMessage }}</p>
      <p v-else-if="noticeMessage" class="mb-2 inline-flex min-h-8 items-center rounded-md bg-success/10 px-3 text-[13px] font-medium text-success">{{ noticeMessage }}</p>
    </div>
    <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div><h2 class="text-sm font-semibold">{{ t('apikeys.title') }}</h2><span class="mt-0.5 block text-xs text-[var(--text-muted)]">{{ keys.length }}</span></div>
        <Button variant="outline" size="sm" :disabled="loading" @click="refresh">{{ t('common.refresh') }}</Button>
      </div>
      <form class="mb-4 flex flex-col gap-2.5 border-b border-border pb-4" @submit.prevent="createKey">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-[var(--text-muted)]">{{ t('apikeys.nameLabel') }}</span>
          <input v-model.trim="keyName" maxlength="100" required :placeholder="t('apikeys.namePlaceholder')" class="min-h-8 rounded-md border border-border bg-[var(--surface)] px-2.5 text-[13px]">
        </label>
        <Button type="submit" :disabled="actionLoading">{{ t('apikeys.createBtn') }}</Button>
      </form>
      <div class="w-full overflow-x-auto rounded-md border border-border">
        <table class="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th v-for="heading in [t('apikeys.table.name'), t('apikeys.table.hint'), t('apikeys.table.status'), t('apikeys.table.lastUsed'), t('apikeys.table.created'), t('apikeys.table.actions')]" :key="heading" class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{{ heading }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in keys" :key="key.id" class="border-b border-border">
              <td class="px-3 py-2 font-semibold">{{ key.name || '—' }}</td>
              <td class="px-3 py-2"><code class="font-mono text-xs">{{ key.key_hint }}</code></td>
              <td class="px-3 py-2"><Badge v-if="key.revoked_at" variant="secondary">{{ t('apikeys.table.revoked') }}</Badge><Badge v-else variant="default">{{ t('apikeys.table.enabled') }}</Badge></td>
              <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ key.last_used_at ? dateTime(key.last_used_at) : '—' }}</td>
              <td class="px-3 py-2 text-xs text-[var(--text-muted)]">{{ dateTime(key.created_at) }}</td>
              <td class="px-3 py-2">
                <Button v-if="!key.revoked_at" variant="ghost" size="sm" :disabled="actionId === key.id" @click="revoke(key)">{{ t('apikeys.table.revoke') }}</Button>
              </td>
            </tr>
            <tr v-if="!keys.length"><td colspan="6" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('common.noData') }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="shownKey" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="shownKey = null">
      <div class="w-full max-w-md rounded-lg border border-border bg-[var(--surface)] p-5 shadow-lg">
        <h3 class="text-sm font-semibold">{{ t('apikeys.keyOnceTitle') }}</h3>
        <p class="mt-1 text-xs text-[var(--text-muted)]">{{ t('apikeys.keyOnceBody') }}</p>
        <div class="mt-3 flex items-center gap-2 rounded-md border border-border bg-[var(--surface-soft)] p-2">
          <code class="min-w-0 flex-1 break-all font-mono text-xs">{{ shownKey.plain }}</code>
          <Button variant="outline" size="sm" @click="copyKey">{{ copied ? t('apikeys.copied') : t('apikeys.copy') }}</Button>
        </div>
        <div class="mt-4 flex justify-end">
          <Button variant="outline" size="sm" @click="shownKey = null">{{ t('common.close') }}</Button>
        </div>
      </div>
    </div>
  </section>
</template>