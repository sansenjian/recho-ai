<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AdminImageAttemptItem, AdminImageAttemptOverview } from '../../types/admin'
import {
  attemptErrorSummary,
  attemptStatusLabel,
  dateTime,
  latencyLabel,
  shortId,
} from '../../utils/admin-format'

const expandedErrors = ref(new Set<string>())

function toggleErrorDetail(id: string) {
  if (expandedErrors.value.has(id)) {
    expandedErrors.value.delete(id)
  } else {
    expandedErrors.value.add(id)
  }
}

const props = defineProps<{
  attempts: AdminImageAttemptItem[]
  overview: AdminImageAttemptOverview | null
  loading: boolean
  statusFilter: string
  userFilter: string
  errorTypeFilter: string
  httpStatusFilter: string
  hoursFilter: string
}>()

const emit = defineEmits<{
  refresh: []
  'update:statusFilter': [value: string]
  'update:userFilter': [value: string]
  'update:errorTypeFilter': [value: string]
  'update:httpStatusFilter': [value: string]
  'update:hoursFilter': [value: string]
}>()

const total = computed(() => props.overview?.total ?? 0)
const selectedWindowLabel = computed(() => {
  if (props.hoursFilter === '168') return '7d'
  if (props.hoursFilter === '720') return '30d'
  return '24h'
})
const outcomeBars = computed(() => [
  {
    key: 'succeeded',
    label: '成功',
    value: props.overview?.succeeded ?? 0,
    className: 'success',
  },
  {
    key: 'failed',
    label: '失败',
    value: props.overview?.failed ?? 0,
    className: 'failed',
  },
])
const topErrorCount = computed(() => Math.max(0, ...((props.overview?.byErrorType || []).map(item => item.count))))

function targetValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function updateStatusFilter(event: Event) {
  emit('update:statusFilter', targetValue(event))
  emit('refresh')
}

function updateHoursFilter(event: Event) {
  emit('update:hoursFilter', targetValue(event))
  emit('refresh')
}

function updateUserFilter(event: Event) {
  emit('update:userFilter', targetValue(event))
}

function updateErrorTypeFilter(event: Event) {
  emit('update:errorTypeFilter', targetValue(event))
}

function updateHttpStatusFilter(event: Event) {
  emit('update:httpStatusFilter', targetValue(event))
}

function barWidth(value: number, max: number) {
  if (!value || !max) return '0%'
  return `${Math.max(5, Math.round((value / max) * 100))}%`
}
</script>

<template>
  <section class="admin-panel attempts-panel" aria-label="生图监控">
    <div class="panel-header attempt-header">
      <div>
        <span>生图监控</span>
        <strong>{{ total }}</strong>
      </div>
      <form class="attempt-controls" @submit.prevent="emit('refresh')">
        <select :value="statusFilter" :disabled="loading" @change="updateStatusFilter">
          <option value="">全部状态</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
        </select>
        <select :value="hoursFilter" :disabled="loading" @change="updateHoursFilter">
          <option value="24">24h</option>
          <option value="168">7d</option>
          <option value="720">30d</option>
        </select>
        <input :value="userFilter" type="search" placeholder="用户 ID" :disabled="loading" @input="updateUserFilter">
        <input :value="errorTypeFilter" type="search" placeholder="错误类型" :disabled="loading" @input="updateErrorTypeFilter">
        <input :value="httpStatusFilter" type="number" min="100" max="599" placeholder="HTTP" :disabled="loading" @input="updateHttpStatusFilter">
        <button type="submit" :disabled="loading">筛选</button>
        <button type="button" :disabled="loading" @click="emit('refresh')">刷新</button>
      </form>
    </div>

    <div class="attempt-metrics">
      <div>
        <span>{{ selectedWindowLabel }} 成功</span>
        <strong>{{ overview?.succeeded ?? 0 }}</strong>
      </div>
      <div>
        <span>{{ selectedWindowLabel }} 失败</span>
        <strong>{{ overview?.failed ?? 0 }}</strong>
      </div>
      <div>
        <span>失败率</span>
        <strong>{{ overview?.failureRate ?? 0 }}%</strong>
      </div>
      <div>
        <span>平均耗时</span>
        <strong>{{ latencyLabel(overview?.averageLatencyMs ?? null) }}</strong>
      </div>
    </div>

    <div class="attempt-charts">
      <div class="chart-block">
        <span class="chart-title">结果分布</span>
        <div v-for="bar in outcomeBars" :key="bar.key" class="chart-row">
          <span>{{ bar.label }}</span>
          <div class="chart-track">
            <i :class="bar.className" :style="{ width: barWidth(bar.value, Math.max(total, 1)) }" />
          </div>
          <strong>{{ bar.value }}</strong>
        </div>
      </div>
      <div class="chart-block">
        <span class="chart-title">错误类型</span>
        <div v-for="item in overview?.byErrorType || []" :key="item.errorType" class="chart-row">
          <span>{{ item.errorType }}</span>
          <div class="chart-track">
            <i class="failed" :style="{ width: barWidth(item.count, topErrorCount) }" />
          </div>
          <strong>{{ item.count }}</strong>
        </div>
        <div v-if="!(overview?.byErrorType || []).length" class="empty-chart">暂无错误类型</div>
      </div>
    </div>

    <div class="table-wrap attempt-table-wrap">
      <table class="attempt-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>用户</th>
            <th>状态</th>
            <th>耗时</th>
            <th>生成 ID</th>
            <th>错误摘要</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="attempt in attempts" :key="attempt.id">
            <td>{{ dateTime(attempt.createdAt) }}</td>
            <td>{{ attempt.email || (attempt.userId ? shortId(attempt.userId) : '-') }}</td>
            <td :class="attempt.status === 'succeeded' ? 'positive' : 'negative'">{{ attemptStatusLabel(attempt.status) }}</td>
            <td>{{ latencyLabel(attempt.latencyMs) }}</td>
            <td>{{ attempt.generationId ? shortId(attempt.generationId) : '-' }}</td>
            <td class="attempt-error-cell">{{ attemptErrorSummary(attempt) }}</td>
            <td>
              <button
                v-if="attempt.status === 'failed'"
                type="button"
                class="expand-btn"
                @click="toggleErrorDetail(attempt.id)"
              >
                {{ expandedErrors.has(attempt.id) ? '收起' : '详情' }}
              </button>
              <span v-else class="table-muted">-</span>
            </td>
          </tr>
          <tr v-for="attempt in attempts" :key="'detail-' + attempt.id" v-show="expandedErrors.has(attempt.id)">
            <td colspan="7" class="error-detail-cell">
              <div class="error-detail">
                <div class="error-row">
                  <span class="error-label">错误类型</span>
                  <span class="error-value">{{ attempt.errorType || '-' }}</span>
                </div>
                <div class="error-row">
                  <span class="error-label">HTTP 状态</span>
                  <span class="error-value">{{ attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : '-' }}</span>
                </div>
                <div class="error-row">
                  <span class="error-label">错误码</span>
                  <span class="error-value">{{ attempt.errorCode || '-' }}</span>
                </div>
                <div class="error-row error-message-row">
                  <span class="error-label">错误信息</span>
                  <pre class="error-message">{{ attempt.errorMessage || '-' }}</pre>
                </div>
              </div>
            </td>
          </tr>
          <tr v-if="!attempts.length">
            <td colspan="7">暂无尝试记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.admin-panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.attempts-panel {
  max-width: 1360px;
  margin: 0 auto 14px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.attempt-header {
  align-items: flex-start;
}

.panel-header strong {
  display: block;
  margin-top: 2px;
  font-size: 18px;
}

.attempt-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

input,
select {
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-primary);
  padding: 7px 9px;
}

select {
  min-width: 110px;
  cursor: pointer;
}

.attempt-controls input {
  width: 150px;
  min-width: 110px;
}

.attempt-controls input[type='number'] {
  width: 96px;
}

button {
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

button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.attempt-metrics,
.attempt-charts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.attempt-charts {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.attempt-metrics div,
.chart-block {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
}

.attempt-metrics span,
.chart-title,
.empty-chart {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.attempt-metrics strong {
  display: block;
  margin-top: 3px;
  font-size: 18px;
}

.chart-title {
  margin-bottom: 8px;
}

.chart-row {
  display: grid;
  grid-template-columns: minmax(70px, 140px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  font-size: 12px;
}

.chart-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 700;
}

.chart-row strong {
  font-size: 12px;
}

.chart-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--border);
}

.chart-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.chart-track .success {
  background: var(--accent);
}

.chart-track .failed {
  background: var(--danger);
}

.empty-chart {
  min-height: 24px;
}

.table-wrap {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.attempt-table {
  min-width: 1020px;
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

.attempt-error-cell {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand-btn {
  min-height: 26px;
  padding: 2px 8px;
  font-size: 11px;
  background: var(--surface-soft);
  color: var(--text-secondary);
}

.expand-btn:hover {
  background: var(--hover-bg);
}

.error-detail-cell {
  background: var(--surface-soft);
  padding: 12px !important;
}

.error-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-row {
  display: flex;
  gap: 12px;
}

.error-label {
  width: 100px;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.error-value {
  font-size: 13px;
  color: var(--text-primary);
}

.error-message-row {
  flex-direction: column;
  gap: 4px;
}

.error-message {
  margin: 0;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--danger);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: none;
  overflow-y: visible;
}

@media (max-width: 980px) {
  .attempt-metrics,
  .attempt-charts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .panel-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .attempt-controls {
    justify-content: flex-start;
    width: 100%;
  }

  .attempt-metrics,
  .attempt-charts {
    grid-template-columns: 1fr;
  }
}
</style>
