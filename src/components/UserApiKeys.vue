<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Trash2 } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiUrl } from '../lib/api-base'
import { localizedClientErrorMessage } from '../utils/client-error-message'
import { localeTag } from '../utils/locale-tag'
import { getAuthAccessToken } from '../composables/useAuthSession'

/**
 * 用户自助 API 密钥：调用 /api/api-keys（只作用于当前登录用户自己的 key），
 * 供 recho-cli 等外部客户端使用。
 */

const { t } = useI18n()

interface UserApiKey {
  id: string
  name: string
  key_hint: string
  enabled: boolean
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

const keys = ref<UserApiKey[]>([])
const keyName = ref('')
const loading = ref(false)
const creating = ref(false)
const revokingId = ref<string | null>(null)
const errorMessage = ref('')
const noticeMessage = ref('')
const issuedKey = ref<string | null>(null)
const copied = ref(false)
const deletingId = ref<string | null>(null)

function shortTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(localeTag(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthAccessToken()
  if (!token) throw new Error(t('feedback.loginRequired'))
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  // no-store：密钥列表属身份敏感数据，不参与缓存/去重
  const response = await fetch(apiUrl(path), { ...init, headers, cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : t('feedback.requestFailed'))
  return data as T
}

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await request<{ keys: UserApiKey[] }>('/api/api-keys')
    keys.value = data.keys
  } catch (err) {
    errorMessage.value = localizedClientErrorMessage(err, 'account.keys.listFailed')
  } finally {
    loading.value = false
  }
}

async function createKey() {
  if (!keyName.value.trim()) return
  creating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await request<{ key: string }>('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: keyName.value.trim() }),
    })
    issuedKey.value = data.key
    copied.value = false
    keyName.value = ''
    await refresh()
  } catch (err) {
    errorMessage.value = localizedClientErrorMessage(err, 'account.keys.createFailed')
  } finally {
    creating.value = false
  }
}

async function revokeKey(key: UserApiKey) {
  revokingId.value = key.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await request<{ ok: boolean }>(`/api/api-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' })
    if (data.ok) {
      keys.value = keys.value.map(item => item.id === key.id ? { ...item, revoked_at: new Date().toISOString() } : item)
      noticeMessage.value = t('account.keys.revokedNotice')
    } else {
      errorMessage.value = t('account.keys.revokeInvalid')
    }
  } catch (err) {
    errorMessage.value = localizedClientErrorMessage(err, 'account.keys.revokeFailed')
  } finally {
    revokingId.value = null
  }
}

async function copyIssuedKey() {
  if (!issuedKey.value) return
  try {
    await navigator.clipboard.writeText(issuedKey.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // 剪贴板不可用时保留明文,用户可手动选择复制
  }
}

/**
 * 物理删除已撤销的 key。撤销后明文与 hash 都已无用,留一条不可用的记录
 * 只会让列表越来越长;未撤销的 key 后端会拒绝删除,必须先撤销。
 */
async function deleteKey(key: UserApiKey) {
  deletingId.value = key.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const data = await request<{ ok: boolean }>(`/api/api-keys/${encodeURIComponent(key.id)}/purge`, { method: 'DELETE' })
    if (data.ok) {
      keys.value = keys.value.filter(item => item.id !== key.id)
      noticeMessage.value = t('account.keys.deletedNotice')
    } else {
      errorMessage.value = t('account.keys.deleteInvalid')
    }
  } catch (err) {
    errorMessage.value = localizedClientErrorMessage(err, 'account.keys.deleteFailed')
  } finally {
    deletingId.value = null
  }
}

onMounted(refresh)
</script>

<template>
  <div>
    <form class="flex gap-2" @submit.prevent="createKey">
      <Input v-model="keyName" maxlength="100" :placeholder="t('account.keys.namePlaceholder')" class="h-9 flex-1 text-[13px]" />
      <Button type="submit" size="sm" class="h-9" :disabled="creating || !keyName.trim()">
        {{ creating ? t('account.keys.creating') : t('account.keys.create') }}
      </Button>
    </form>

    <div aria-live="polite">
      <p v-if="errorMessage" class="mt-2 text-xs text-destructive">{{ errorMessage }}</p>
      <p v-else-if="noticeMessage" class="mt-2 text-xs text-muted-foreground">{{ noticeMessage }}</p>
    </div>

    <div v-if="issuedKey" class="mt-3 rounded-md border border-border bg-muted p-2.5">
      <p class="text-xs font-medium">{{ t('account.keys.createdOnceTitle') }}</p>
      <div class="mt-2 flex items-center gap-2">
        <code class="min-w-0 flex-1 break-all font-mono text-xs">{{ issuedKey }}</code>
        <Button type="button" variant="outline" size="sm" class="shrink-0" @click="copyIssuedKey">
          <Copy :size="12" />
          {{ copied ? t('account.keys.copied') : t('common.copy') }}
        </Button>
      </div>
      <p class="mt-2 text-[11px] text-muted-foreground">{{ t('account.keys.createdOnceBody') }}</p>
    </div>

    <div v-if="loading && !keys.length" class="mt-3 text-xs text-muted-foreground">{{ t('common.loading') }}</div>
    <ul v-else-if="keys.length" class="mt-3 flex flex-col gap-2">
      <li v-for="key in keys" :key="key.id" class="flex items-start justify-between gap-2 rounded-md border border-border p-2.5">
        <div class="min-w-0 flex flex-col gap-1">
          <span class="flex items-center gap-2 text-[13px] font-medium">
            {{ key.name || t('account.keys.unnamed') }}
            <Badge v-if="key.revoked_at" variant="secondary" class="text-[11px]">{{ t('account.keys.revoked') }}</Badge>
            <Badge v-else variant="default" class="text-[11px]">{{ t('account.keys.enabled') }}</Badge>
          </span>
          <code class="break-all font-mono text-[11px] text-muted-foreground">{{ key.key_hint }}</code>
          <span class="text-[11px] text-muted-foreground">{{ t('account.keys.created', { time: shortTime(key.created_at) }) }}</span>
          <!-- 撤销与删除都不可逆,先把「最近用过没有」摆出来,别让用户凭记忆判断。 -->
          <span class="text-[11px] text-muted-foreground">
            {{ key.last_used_at ? t('account.keys.lastUsed', { time: shortTime(key.last_used_at) }) : t('account.keys.neverUsed') }}
          </span>
        </div>
        <Button
          v-if="!key.revoked_at"
          type="button"
          variant="ghost"
          size="sm"
          class="shrink-0"
          :disabled="revokingId === key.id"
          @click="revokeKey(key)"
        >
          {{ t('account.keys.revoke') }}
        </Button>
        <!-- 删除只对已撤销的 key 开放：明文早已不可恢复，留下的只是一条死记录。 -->
        <Button
          v-else
          type="button"
          variant="ghost"
          size="sm"
          class="shrink-0 text-muted-foreground hover:text-destructive"
          :disabled="deletingId === key.id"
          @click="deleteKey(key)"
        >
          <Trash2 :size="13" />
          {{ t('account.keys.delete') }}
        </Button>
      </li>
    </ul>
    <p v-else class="mt-3 text-xs text-muted-foreground">{{ t('account.keys.empty') }}</p>
  </div>
</template>
