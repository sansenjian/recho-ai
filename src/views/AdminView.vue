<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { apiUrl } from '../lib/api-base'
import { publicClientErrorMessage } from '../lib/safe-error'
import { getAuthAccessToken, useAuthSession } from '../composables/useAuthSession'

interface AdminUser {
  userId: string
  email: string | null
  balance: number
  totalRedeemed: number
  totalSpent: number
  createdAt: string | null
  updatedAt: string | null
  lastSignInAt: string | null
}

interface AdminCode {
  id: string
  code?: string
  credits: number
  maxRedemptions: number
  redeemedCount: number
  expiresAt: string | null
  disabledAt: string | null
  note: string | null
  createdAt: string | null
}

interface AdminTransaction {
  id: string
  amount: number
  balance_after: number
  reason: string
  metadata?: Record<string, unknown> | null
  created_at: string | null
}

interface AdminOverview {
  users: {
    withCreditRows: number
    totalBalance: number
    totalRedeemed: number
    totalSpent: number
  }
  codes: {
    total: number
    active: number
    disabled: number
    expired: number
    exhausted: number
    totalIssuedCredits: number
    totalRedeemedCredits: number
  }
  transactions: {
    last7Days: {
      totalCount: number
      redeemedCredits: number
      spentCredits: number
      refundedCredits: number
      adminAdjustedCredits: number
    }
    byReason: Array<{
      reason: string
      count: number
      amount: number
    }>
  }
  generatedAt: string
}

const {
  user,
  userEmail,
  isAuthReady,
  initAuth,
} = useAuthSession()

const adminChecked = ref(false)
const isAdmin = ref(false)
const loading = ref(false)
const overviewLoading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')

const users = ref<AdminUser[]>([])
const selectedUser = ref<AdminUser | null>(null)
const transactions = ref<AdminTransaction[]>([])
const codes = ref<AdminCode[]>([])
const createdCodes = ref<AdminCode[]>([])
const overview = ref<AdminOverview | null>(null)

const userQuery = ref('')
const adjustAmount = ref(10)
const adjustNote = ref('')

const codeForm = ref({
  prefix: 'RECHO',
  credits: 100,
  count: 10,
  maxRedemptions: 1,
  days: 30,
  note: '',
})

const selectedUserTitle = computed(() => {
  if (!selectedUser.value) return '未选择用户'
  return selectedUser.value.email || shortId(selectedUser.value.userId)
})

const overviewCodeHealth = computed(() => {
  if (!overview.value) return '0 / 0'
  return `${overview.value.codes.active} / ${overview.value.codes.total}`
})

const overviewNetChange = computed(() => {
  const recent = overview.value?.transactions.last7Days
  if (!recent) return 0
  return recent.redeemedCredits + recent.refundedCredits + recent.adminAdjustedCredits - recent.spentCredits
})

const overviewGeneratedAt = computed(() => {
  if (!overview.value) return '等待刷新'
  return `更新 ${dateTime(overview.value.generatedAt)}`
})

const createdCsv = computed(() => {
  const rows = [
    ['code', 'credits', 'max_redemptions', 'expires_at', 'note', 'database_id'],
    ...createdCodes.value.map(code => [
      code.code || '',
      String(code.credits),
      String(code.maxRedemptions),
      code.expiresAt || '',
      code.note || '',
      code.id,
    ]),
  ]
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
})

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function dateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function codeStatus(code: AdminCode) {
  if (code.disabledAt) return '已停用'
  if (code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now()) return '已过期'
  if (code.redeemedCount >= code.maxRedemptions) return '已用完'
  return '可用'
}

function transactionReason(reason: string) {
  if (reason === 'redemption') return '兑换'
  if (reason === 'image_generation') return '生图'
  if (reason === 'refund') return '退款'
  if (reason === 'admin_adjustment') return '后台调整'
  return reason
}

function transactionNote(tx: AdminTransaction) {
  const note = tx.metadata?.note
  return typeof note === 'string' && note.trim() ? note : '-'
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthAccessToken()
  if (!token) throw new Error('请先登录。')

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : '请求失败')
  }
  return data as T
}

function setError(error: unknown, fallback = '后台操作失败，请稍后重试。') {
  errorMessage.value = publicClientErrorMessage(error, fallback)
}

async function checkAdmin() {
  errorMessage.value = ''
  adminChecked.value = false
  try {
    await apiJson<{ admin: boolean }>('/api/admin/credits/me')
    isAdmin.value = true
  } catch (error) {
    isAdmin.value = false
    setError(error, '当前账号没有后台权限。')
  } finally {
    adminChecked.value = true
  }
}

async function refreshUsers() {
  loading.value = true
  errorMessage.value = ''
  try {
    const query = new URLSearchParams()
    query.set('limit', '50')
    if (userQuery.value.trim()) query.set('query', userQuery.value.trim())
    const data = await apiJson<{ users: AdminUser[] }>(`/api/admin/credits/users?${query.toString()}`)
    users.value = data.users
    if (!selectedUser.value && data.users[0]) {
      await selectUser(data.users[0])
    } else if (selectedUser.value) {
      const updated = data.users.find(item => item.userId === selectedUser.value?.userId)
      if (updated) selectedUser.value = updated
    }
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
    const data = await apiJson<{ codes: AdminCode[] }>('/api/admin/credits/codes?limit=50')
    codes.value = data.codes
  } catch (error) {
    setError(error)
  } finally {
    loading.value = false
  }
}

async function refreshOverview() {
  overviewLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ overview: AdminOverview }>('/api/admin/credits/overview')
    overview.value = data.overview
  } catch (error) {
    setError(error)
  } finally {
    overviewLoading.value = false
  }
}

async function selectUser(target: AdminUser) {
  selectedUser.value = target
  errorMessage.value = ''
  try {
    const data = await apiJson<{ user: AdminUser; transactions: AdminTransaction[] }>(`/api/admin/credits/users/${encodeURIComponent(target.userId)}?limit=30`)
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
    const data = await apiJson<{ user: AdminUser; transactions: AdminTransaction[] }>(
      `/api/admin/credits/users/${encodeURIComponent(selectedUser.value.userId)}/adjust`,
      {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(adjustAmount.value),
          note: adjustNote.value,
        }),
      },
    )
    selectedUser.value = data.user
    transactions.value = data.transactions
    users.value = users.value.map(item => item.userId === data.user.userId ? data.user : item)
    adjustNote.value = ''
    noticeMessage.value = '额度已调整'
    await refreshOverview()
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
    const data = await apiJson<{ codes: AdminCode[] }>('/api/admin/credits/codes', {
      method: 'POST',
      body: JSON.stringify({
        prefix: codeForm.value.prefix,
        credits: Number(codeForm.value.credits),
        count: Number(codeForm.value.count),
        maxRedemptions: Number(codeForm.value.maxRedemptions),
        days: Number(codeForm.value.days),
        note: codeForm.value.note,
      }),
    })
    createdCodes.value = data.codes
    noticeMessage.value = `已生成 ${data.codes.length} 个兑换码`
    await Promise.all([refreshCodes(), refreshOverview()])
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function setCodeDisabled(code: AdminCode, disabled: boolean) {
  if (disabled && !window.confirm('确认停用这个兑换码？')) return
  actionLoading.value = true
  errorMessage.value = ''
  try {
    const data = await apiJson<{ code: AdminCode }>(`/api/admin/credits/codes/${encodeURIComponent(code.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    })
    codes.value = codes.value.map(item => item.id === data.code.id ? data.code : item)
    noticeMessage.value = disabled ? '兑换码已停用' : '兑换码已恢复'
    await refreshOverview()
  } catch (error) {
    setError(error)
  } finally {
    actionLoading.value = false
  }
}

async function copyCreatedCsv() {
  if (!createdCodes.value.length) return
  try {
    await navigator.clipboard.writeText(createdCsv.value)
    noticeMessage.value = 'CSV 已复制'
  } catch (error) {
    setError(error, '复制失败，请手动选择内容。')
  }
}

function downloadCreatedCsv() {
  if (!createdCodes.value.length) return
  const blob = new Blob([`${createdCsv.value}\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `recho-credit-codes-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  await initAuth()
  await checkAdmin()
  if (isAdmin.value) {
    await Promise.all([refreshOverview(), refreshUsers(), refreshCodes()])
  }
})
</script>

<template>
  <main class="admin-page">
    <header class="admin-header">
      <div>
        <span class="admin-eyebrow">Recho Admin</span>
        <h1>额度后台</h1>
      </div>
      <nav class="admin-nav" aria-label="后台导航">
        <RouterLink to="/image">画布</RouterLink>
        <RouterLink to="/works">作品</RouterLink>
      </nav>
    </header>

    <section v-if="!isAuthReady || !adminChecked" class="admin-state">
      <span class="spinner" />
      <strong>正在检查权限</strong>
    </section>

    <section v-else-if="!user" class="admin-state">
      <strong>请先登录</strong>
      <RouterLink to="/image">返回登录</RouterLink>
    </section>

    <section v-else-if="!isAdmin" class="admin-state">
      <strong>{{ errorMessage || '当前账号没有后台权限。' }}</strong>
      <span>{{ userEmail }}</span>
    </section>

    <template v-else>
      <div class="admin-feedback" aria-live="polite">
        <p v-if="errorMessage" class="admin-message error">{{ errorMessage }}</p>
        <p v-if="noticeMessage" class="admin-message success">{{ noticeMessage }}</p>
      </div>

      <section class="overview-panel" aria-label="额度总览">
        <div class="overview-header">
          <div>
            <span>总览</span>
            <strong>{{ overviewGeneratedAt }}</strong>
          </div>
          <button type="button" :disabled="overviewLoading" @click="refreshOverview">刷新</button>
        </div>
        <div class="overview-grid">
          <div>
            <span>总余额</span>
            <strong>{{ overview?.users.totalBalance ?? 0 }}</strong>
          </div>
          <div>
            <span>累计兑换</span>
            <strong>{{ overview?.users.totalRedeemed ?? 0 }}</strong>
          </div>
          <div>
            <span>累计消耗</span>
            <strong>{{ overview?.users.totalSpent ?? 0 }}</strong>
          </div>
          <div>
            <span>兑换码可用</span>
            <strong>{{ overviewCodeHealth }}</strong>
          </div>
          <div>
            <span>已兑换码额度</span>
            <strong>{{ overview?.codes.totalRedeemedCredits ?? 0 }}</strong>
          </div>
          <div>
            <span>7 天流水</span>
            <strong>{{ overview?.transactions.last7Days.totalCount ?? 0 }}</strong>
          </div>
          <div>
            <span>7 天消耗</span>
            <strong>{{ overview?.transactions.last7Days.spentCredits ?? 0 }}</strong>
          </div>
          <div>
            <span>7 天净变化</span>
            <strong :class="overviewNetChange >= 0 ? 'positive' : 'negative'">{{ overviewNetChange > 0 ? '+' : '' }}{{ overviewNetChange }}</strong>
          </div>
        </div>
      </section>

      <section class="admin-grid">
        <div class="admin-panel users-panel">
          <div class="panel-header">
            <div>
              <span>用户</span>
              <strong>{{ users.length }}</strong>
            </div>
            <button type="button" :disabled="loading" @click="refreshUsers">刷新</button>
          </div>
          <form class="search-row" @submit.prevent="refreshUsers">
            <input v-model.trim="userQuery" type="search" placeholder="邮箱或用户 ID">
            <button type="submit" :disabled="loading">搜索</button>
          </form>
          <div class="user-list">
            <button
              v-for="item in users"
              :key="item.userId"
              type="button"
              class="user-row"
              :class="{ active: selectedUser?.userId === item.userId }"
              @click="selectUser(item)"
            >
              <span>{{ item.email || shortId(item.userId) }}</span>
              <strong>{{ item.balance }}</strong>
            </button>
          </div>
        </div>

        <div class="admin-panel detail-panel">
          <div class="panel-header">
            <div>
              <span>当前用户</span>
              <strong>{{ selectedUserTitle }}</strong>
            </div>
          </div>

          <div v-if="selectedUser" class="metric-grid">
            <div>
              <span>余额</span>
              <strong>{{ selectedUser.balance }}</strong>
            </div>
            <div>
              <span>累计兑换</span>
              <strong>{{ selectedUser.totalRedeemed }}</strong>
            </div>
            <div>
              <span>累计消耗</span>
              <strong>{{ selectedUser.totalSpent }}</strong>
            </div>
            <div>
              <span>更新</span>
              <strong>{{ dateTime(selectedUser.updatedAt) }}</strong>
            </div>
          </div>

          <form class="adjust-form" @submit.prevent="submitAdjustment">
            <label>
              <span>调整额度</span>
              <input v-model.number="adjustAmount" type="number" step="1" placeholder="正数增加，负数扣除">
            </label>
            <label>
              <span>备注</span>
              <input v-model.trim="adjustNote" type="text" placeholder="内部备注">
            </label>
            <button type="submit" :disabled="actionLoading || !selectedUser || !adjustAmount">提交</button>
          </form>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>变动</th>
                  <th>余额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tx in transactions" :key="tx.id">
                  <td>{{ dateTime(tx.created_at) }}</td>
                  <td>{{ transactionReason(tx.reason) }}</td>
                  <td :class="tx.amount > 0 ? 'positive' : 'negative'">{{ tx.amount > 0 ? '+' : '' }}{{ tx.amount }}</td>
                  <td>{{ tx.balance_after }}</td>
                  <td>{{ transactionNote(tx) }}</td>
                </tr>
                <tr v-if="!transactions.length">
                  <td colspan="5">暂无流水</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="admin-grid codes-grid">
        <div class="admin-panel">
          <div class="panel-header">
            <div>
              <span>生成兑换码</span>
              <strong>{{ codeForm.count }} 个</strong>
            </div>
          </div>

          <form class="code-form" @submit.prevent="createCodes">
            <label>
              <span>前缀</span>
              <input v-model.trim="codeForm.prefix" type="text">
            </label>
            <label>
              <span>额度</span>
              <input v-model.number="codeForm.credits" type="number" min="1" step="1">
            </label>
            <label>
              <span>数量</span>
              <input v-model.number="codeForm.count" type="number" min="1" max="100" step="1">
            </label>
            <label>
              <span>可兑换次数</span>
              <input v-model.number="codeForm.maxRedemptions" type="number" min="1" step="1">
            </label>
            <label>
              <span>有效天数</span>
              <input v-model.number="codeForm.days" type="number" min="1" step="1">
            </label>
            <label class="wide">
              <span>备注</span>
              <input v-model.trim="codeForm.note" type="text">
            </label>
            <button type="submit" :disabled="actionLoading">生成</button>
          </form>

          <div v-if="createdCodes.length" class="created-codes">
            <div class="created-actions">
              <strong>本次生成</strong>
              <button type="button" @click="copyCreatedCsv">复制 CSV</button>
              <button type="button" @click="downloadCreatedCsv">下载 CSV</button>
            </div>
            <textarea :value="createdCsv" readonly rows="6" />
          </div>
        </div>

        <div class="admin-panel">
          <div class="panel-header">
            <div>
              <span>兑换码</span>
              <strong>{{ codes.length }}</strong>
            </div>
            <button type="button" :disabled="loading" @click="refreshCodes">刷新</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>创建</th>
                  <th>额度</th>
                  <th>使用</th>
                  <th>状态</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="code in codes" :key="code.id">
                  <td>{{ dateTime(code.createdAt) }}</td>
                  <td>{{ code.credits }}</td>
                  <td>{{ code.redeemedCount }} / {{ code.maxRedemptions }}</td>
                  <td>{{ codeStatus(code) }}</td>
                  <td>{{ code.note || '-' }}</td>
                  <td>
                    <button
                      type="button"
                      class="table-action"
                      :disabled="actionLoading"
                      @click="setCodeDisabled(code, !code.disabledAt)"
                    >
                      {{ code.disabledAt ? '恢复' : '停用' }}
                    </button>
                  </td>
                </tr>
                <tr v-if="!codes.length">
                  <td colspan="6">暂无兑换码</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.admin-page {
  min-height: 100vh;
  padding: 22px;
  background: var(--bg);
  color: var(--text-primary);
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  max-width: 1360px;
  margin: 0 auto 18px;
}

.admin-eyebrow,
.overview-header span,
.overview-grid span,
.panel-header span,
.metric-grid span,
.adjust-form span,
.code-form span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.admin-header h1 {
  font-size: 28px;
  line-height: 1.2;
}

.admin-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-nav a,
.admin-state a,
.overview-header button,
.panel-header button,
.search-row button,
.adjust-form button,
.code-form button,
.created-actions button,
.table-action {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

.admin-nav a:hover,
.admin-state a:hover,
.overview-header button:hover:not(:disabled),
.panel-header button:hover:not(:disabled),
.search-row button:hover:not(:disabled),
.adjust-form button:hover:not(:disabled),
.code-form button:hover:not(:disabled),
.created-actions button:hover,
.table-action:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.admin-state {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 360px;
  max-width: 720px;
  margin: 0 auto;
  padding: 32px;
  text-align: center;
}

.spinner {
  width: 22px;
  height: 22px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.admin-feedback {
  max-width: 1360px;
  min-height: 34px;
  margin: 0 auto 10px;
}

.admin-message {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 800;
}

.admin-message.error {
  background: rgba(220, 38, 38, 0.1);
  color: var(--danger);
}

.admin-message.success {
  background: var(--accent-soft);
  color: var(--accent);
}

.overview-panel {
  max-width: 1360px;
  margin: 0 auto 14px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.overview-header strong {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 13px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 10px;
}

.overview-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.overview-grid strong {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.admin-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 14px;
  max-width: 1360px;
  margin: 0 auto 14px;
}

.codes-grid {
  grid-template-columns: minmax(360px, 0.8fr) minmax(0, 1.2fr);
}

.admin-panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.panel-header,
.created-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.panel-header strong {
  display: block;
  margin-top: 2px;
  font-size: 18px;
}

.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 10px;
}

input,
textarea {
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-primary);
  padding: 7px 9px;
}

textarea {
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
}

.user-list {
  display: grid;
  gap: 6px;
  max-height: 470px;
  overflow: auto;
}

.user-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
  color: var(--text-primary);
  text-align: left;
}

.user-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-row.active {
  border-color: rgba(37, 99, 235, 0.42);
  background: rgba(37, 99, 235, 0.08);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.metric-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.metric-grid strong {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.adjust-form,
.code-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  align-items: end;
  gap: 10px;
  margin-bottom: 14px;
}

.code-form {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.code-form .wide {
  grid-column: span 2;
}

.code-form button {
  align-self: end;
}

.table-wrap {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

th {
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.positive {
  color: var(--accent);
  font-weight: 800;
}

.negative {
  color: var(--danger);
  font-weight: 800;
}

.created-codes {
  margin-top: 12px;
}

.created-actions {
  justify-content: flex-start;
}

@media (max-width: 980px) {
  .admin-grid,
  .codes-grid {
    grid-template-columns: 1fr;
  }

  .overview-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .admin-page {
    padding: 14px;
  }

  .admin-header,
  .adjust-form,
  .code-form {
    grid-template-columns: 1fr;
  }

  .admin-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .code-form .wide {
    grid-column: auto;
  }
}
</style>
