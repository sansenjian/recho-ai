<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
    className: 'bg-emerald-500',
  },
  {
    key: 'failed',
    label: '失败',
    value: props.overview?.failed ?? 0,
    className: 'bg-red-500',
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
  <section class="mx-auto mb-3.5 w-full min-w-0 max-w-[1360px] rounded-lg border border-border bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]" aria-label="生图监控">
    <div class="flex items-start justify-between gap-2.5 mb-3 max-[680px]:flex-col max-[680px]:items-start">
      <div>
        <span class="block text-sm">生图监控</span>
        <strong class="block mt-0.5 text-lg">{{ total }}</strong>
      </div>
      <form class="flex items-center justify-end gap-2 flex-wrap max-[680px]:justify-start max-[680px]:w-full" @submit.prevent="emit('refresh')">
        <select
          :value="statusFilter"
          :disabled="loading"
          class="min-h-9 min-w-[110px] cursor-pointer rounded-md border border-border bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @change="updateStatusFilter"
        >
          <option value="">全部状态</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
        </select>
        <select
          :value="hoursFilter"
          :disabled="loading"
          class="min-h-9 min-w-[110px] cursor-pointer rounded-md border border-border bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @change="updateHoursFilter"
        >
          <option value="24">24h</option>
          <option value="168">7d</option>
          <option value="720">30d</option>
        </select>
        <input
          :value="userFilter"
          type="search"
          placeholder="用户 ID"
          :disabled="loading"
          class="min-h-9 w-[150px] min-w-[110px] rounded-md border border-border bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @input="updateUserFilter"
        >
        <input
          :value="errorTypeFilter"
          type="search"
          placeholder="错误类型"
          :disabled="loading"
          class="min-h-9 w-[150px] min-w-[110px] rounded-md border border-border bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @input="updateErrorTypeFilter"
        >
        <input
          :value="httpStatusFilter"
          type="number"
          min="100"
          max="599"
          placeholder="HTTP"
          :disabled="loading"
          class="min-h-9 w-24 rounded-md border border-border bg-[var(--input-bg)] text-[var(--text-primary)] px-2 py-1.5 text-sm"
          @input="updateHttpStatusFilter"
        >
        <Button type="submit" variant="outline" size="sm" :disabled="loading">筛选</Button>
        <Button type="button" variant="outline" size="sm" :disabled="loading" @click="emit('refresh')">刷新</Button>
      </form>
    </div>

    <div class="grid grid-cols-4 gap-2.5 mb-2.5 max-[980px]:grid-cols-2 max-[680px]:grid-cols-1">
      <div class="min-w-0 p-2.5 rounded-md border border-border bg-[var(--surface-soft)]">
        <span class="block text-xs font-extrabold text-[var(--text-secondary)]">{{ selectedWindowLabel }} 成功</span>
        <strong class="block mt-[3px] text-lg">{{ overview?.succeeded ?? 0 }}</strong>
      </div>
      <div class="min-w-0 p-2.5 rounded-md border border-border bg-[var(--surface-soft)]">
        <span class="block text-xs font-extrabold text-[var(--text-secondary)]">{{ selectedWindowLabel }} 失败</span>
        <strong class="block mt-[3px] text-lg">{{ overview?.failed ?? 0 }}</strong>
      </div>
      <div class="min-w-0 p-2.5 rounded-md border border-border bg-[var(--surface-soft)]">
        <span class="block text-xs font-extrabold text-[var(--text-secondary)]">失败率</span>
        <strong class="block mt-[3px] text-lg">{{ overview?.failureRate ?? 0 }}%</strong>
      </div>
      <div class="min-w-0 p-2.5 rounded-md border border-border bg-[var(--surface-soft)]">
        <span class="block text-xs font-extrabold text-[var(--text-secondary)]">平均耗时</span>
        <strong class="block mt-[3px] text-lg">{{ latencyLabel(overview?.averageLatencyMs ?? null) }}</strong>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2.5 mb-2.5 max-[980px]:grid-cols-2 max-[680px]:grid-cols-1">
      <div class="min-w-0 p-2.5 rounded-md border border-border bg-[var(--surface-soft)]">
        <span class="block text-xs font-extrabold text-[var(--text-secondary)] mb-2">结果分布</span>
        <div v-for="bar in outcomeBars" :key="bar.key" class="grid grid-cols-[minmax(70px,140px)_minmax(0,1fr)_auto] items-center gap-2 min-h-6 text-xs">
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-primary)] font-bold">{{ bar.label }}</span>
          <div class="h-2 overflow-hidden rounded-full bg-border">
            <div :class="bar.className" :style="{ width: barWidth(bar.value, Math.max(total, 1)) }" class="h-full rounded-full" />
          </div>
          <strong class="text-xs">{{ bar.value }}</strong>
        </div>
      </div>
      <div class="min-w-0 p-2.5 rounded-md border border-border bg-[var(--surface-soft)]">
        <span class="block text-xs font-extrabold text-[var(--text-secondary)] mb-2">错误类型</span>
        <div v-for="item in overview?.byErrorType || []" :key="item.errorType" class="grid grid-cols-[minmax(70px,140px)_minmax(0,1fr)_auto] items-center gap-2 min-h-6 text-xs">
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-primary)] font-bold">{{ item.errorType }}</span>
          <div class="h-2 overflow-hidden rounded-full bg-border">
            <div class="h-full rounded-full bg-red-500" :style="{ width: barWidth(item.count, topErrorCount) }" />
          </div>
          <strong class="text-xs">{{ item.count }}</strong>
        </div>
        <div v-if="!(overview?.byErrorType || []).length" class="min-h-6 text-xs font-extrabold text-[var(--text-secondary)]">暂无错误类型</div>
      </div>
    </div>

    <div class="w-full overflow-auto rounded-lg border border-border">
      <table class="w-full border-collapse text-[13px] min-w-[1020px]">
        <thead>
          <tr>
            <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-border">时间</th>
            <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-border">用户</th>
            <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-border">状态</th>
            <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-border">耗时</th>
            <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-border">生成 ID</th>
            <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-border">错误摘要</th>
            <th class="text-left px-3 py-2 bg-[var(--surface-soft)] text-[var(--text-secondary)] text-xs font-extrabold border-b border-border">详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="attempt in attempts" :key="attempt.id" class="border-b border-border">
            <td class="px-3 py-2 align-middle">{{ dateTime(attempt.createdAt) }}</td>
            <td class="px-3 py-2 align-middle">{{ attempt.email || (attempt.userId ? shortId(attempt.userId) : '-') }}</td>
            <td class="px-3 py-2 align-middle">
              <Badge :variant="attempt.status === 'succeeded' ? 'default' : 'destructive'">{{ attemptStatusLabel(attempt.status) }}</Badge>
            </td>
            <td class="px-3 py-2 align-middle">{{ latencyLabel(attempt.latencyMs) }}</td>
            <td class="px-3 py-2 align-middle">{{ attempt.generationId ? shortId(attempt.generationId) : '-' }}</td>
            <td class="px-3 py-2 align-middle max-w-[380px] overflow-hidden text-ellipsis whitespace-nowrap">{{ attemptErrorSummary(attempt) }}</td>
            <td class="px-3 py-2 align-middle">
              <Button
                v-if="attempt.status === 'failed'"
                type="button"
                variant="ghost"
                size="xs"
                @click="toggleErrorDetail(attempt.id)"
              >
                {{ expandedErrors.has(attempt.id) ? '收起' : '详情' }}
              </Button>
              <span v-else class="text-xs font-extrabold text-[var(--text-secondary)]">-</span>
            </td>
          </tr>
          <tr v-for="attempt in attempts" :key="'detail-' + attempt.id" v-show="expandedErrors.has(attempt.id)">
            <td colspan="7" class="bg-[var(--surface-soft)] p-3">
              <div class="flex flex-col gap-2">
                <div class="flex gap-3">
                  <span class="w-[100px] text-xs font-extrabold text-[var(--text-secondary)] shrink-0">错误类型</span>
                  <span class="text-[13px] text-[var(--text-primary)]">{{ attempt.errorType || '-' }}</span>
                </div>
                <div class="flex gap-3">
                  <span class="w-[100px] text-xs font-extrabold text-[var(--text-secondary)] shrink-0">HTTP 状态</span>
                  <span class="text-[13px] text-[var(--text-primary)]">{{ attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : '-' }}</span>
                </div>
                <div class="flex gap-3">
                  <span class="w-[100px] text-xs font-extrabold text-[var(--text-secondary)] shrink-0">错误码</span>
                  <span class="text-[13px] text-[var(--text-primary)]">{{ attempt.errorCode || '-' }}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="w-[100px] text-xs font-extrabold text-[var(--text-secondary)] shrink-0">错误信息</span>
                  <pre class="m-0 p-2 bg-[var(--surface)] border border-border rounded-md text-xs text-red-500 whitespace-pre-wrap break-all">{{ attempt.errorMessage || '-' }}</pre>
                </div>
              </div>
            </td>
          </tr>
          <tr v-if="!attempts.length">
            <td colspan="7" class="px-3 py-2 text-center">暂无尝试记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
