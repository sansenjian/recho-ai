<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Copy, KeyRound } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiUrl } from '../lib/api-base'
import { publicClientErrorMessage } from '../lib/safe-error'
import { getAuthAccessToken } from '../composables/useAuthSession'

/**
 * 用户自助 API 密钥：调用 /api/api-keys（只作用于当前登录用户自己的 key），
 * 供 recho-cli 等外部客户端使用。
 */

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

function shortTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthAccessToken()
  if (!token) throw new Error('请先登录。')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  // no-store：密钥列表属身份敏感数据，不参与缓存/去重
  const response = await fetch(apiUrl(path), { ...init, headers, cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '请求失败')
  return data as T
}

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await request<{ keys: UserApiKey[] }>('/api/api-keys')
    keys.value = data.keys
  } catch (err) {
    errorMessage.value = publicClientErrorMessage(err, '密钥列表加载失败，请稍后重试。')
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
    errorMessage.value = publicClientErrorMessage(err, '签发失败，请稍后重试。')
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
      noticeMessage.value = '密钥已撤销。'
    } else {
      errorMessage.value = '撤销失败，密钥可能已失效。'
    }
  } catch (err) {
    errorMessage.value = publicClientErrorMessage(err, '撤销失败，请稍后重试。')
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

onMounted(refresh)
</script>

<template>
  <section class="border-t border-border pt-4">
    <div class="flex items-center gap-2">
      <KeyRound :size="14" />
      <span class="text-[13px] font-medium">API 密钥</span>
    </div>
    <p class="mt-1 text-xs text-muted-foreground">
      用于 recho-cli 等外部客户端；密钥绑定你的账号，请妥善保管。
    </p>

    <form class="mt-3 flex gap-2" @submit.prevent="createKey">
      <Input v-model="keyName" maxlength="100" placeholder="密钥名称，例如 recho-cli" class="h-9 flex-1 text-[13px]" />
      <Button type="submit" size="sm" class="h-9" :disabled="creating || !keyName.trim()">
        {{ creating ? '签发中' : '签发' }}
      </Button>
    </form>

    <div aria-live="polite">
      <p v-if="errorMessage" class="mt-2 text-xs text-destructive">{{ errorMessage }}</p>
      <p v-else-if="noticeMessage" class="mt-2 text-xs text-muted-foreground">{{ noticeMessage }}</p>
    </div>

    <div v-if="issuedKey" class="mt-3 rounded-md border border-border bg-muted p-2.5">
      <p class="text-xs font-medium">密钥已签发（仅显示一次）</p>
      <div class="mt-2 flex items-center gap-2">
        <code class="min-w-0 flex-1 break-all font-mono text-xs">{{ issuedKey }}</code>
        <Button type="button" variant="outline" size="sm" class="shrink-0" @click="copyIssuedKey">
          <Copy :size="12" />
          {{ copied ? '已复制' : '复制' }}
        </Button>
      </div>
      <p class="mt-2 text-[11px] text-muted-foreground">关闭后无法再次查看明文。</p>
    </div>

    <div v-if="loading && !keys.length" class="mt-3 text-xs text-muted-foreground">加载中...</div>
    <ul v-else-if="keys.length" class="mt-3 flex flex-col gap-2">
      <li v-for="key in keys" :key="key.id" class="flex items-start justify-between gap-2 rounded-md border border-border p-2.5">
        <div class="min-w-0 flex flex-col gap-1">
          <span class="flex items-center gap-2 text-[13px] font-medium">
            {{ key.name || '未命名密钥' }}
            <Badge v-if="key.revoked_at" variant="secondary" class="text-[11px]">已撤销</Badge>
            <Badge v-else variant="default" class="text-[11px]">启用</Badge>
          </span>
          <code class="break-all font-mono text-[11px] text-muted-foreground">{{ key.key_hint }}</code>
          <span class="text-[11px] text-muted-foreground">创建 {{ shortTime(key.created_at) }}</span>
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
          撤销
        </Button>
      </li>
    </ul>
    <p v-else class="mt-3 text-xs text-muted-foreground">还没有密钥。</p>
  </section>
</template>