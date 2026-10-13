<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { adminApiJson } from '../../composables/useAdminApi'
import AdminStatusBanner from './AdminStatusBanner.vue'
import type { AdminImageAnalytics } from '../../types/admin'
import { adminErrorMessage, dateTime } from '../../utils/admin-format'

/**
 * 图片分析看板。
 *
 * 数据来自 image_events 与 image_generation_contexts 两张网关侧分析表，只有
 * service_role 能读，所以这里必须经 /api/admin/image-analytics 走管理端鉴权。
 *
 * 默认关闭是设计如此（app_settings 里 imageEventsEnabled / canvasContextEnabled
 * 都默认 false）。这意味着这个页面最常见的状态是「两张表都没数据」——空态不是
 * 异常，而是一份待办清单：它直接告诉你哪些采集还没接线。所以空态要把「为什么
 * 是空的」讲清楚，而不是只显示一句暂无数据。
 */
const props = defineProps<{ refreshVersion?: number }>()
const { t } = useI18n()

const analytics = ref<AdminImageAnalytics | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const loadedVersion = ref(-1)
const windowHours = ref('168')
/** 请求序号：只让最后发出的那次请求写入状态。 */
let loadSeq = 0

const windowOptions = [
  { hours: '24', labelKey: 'analytics.window24h' },
  { hours: '168', labelKey: 'analytics.window7d' },
  { hours: '720', labelKey: 'analytics.window30d' },
]

const hasEvents = computed(() => (analytics.value?.events.total ?? 0) > 0)
const hasContexts = computed(() => (analytics.value?.contexts.total ?? 0) > 0)
const hasAnything = computed(() => hasEvents.value || hasContexts.value)

/** 两个采集开关都还没打开时，页面全是空的——这时给一句话说明原因。 */
const collectionGaps = computed(() => {
  const gaps: string[] = []
  if (!hasEvents.value) gaps.push(t('analytics.gapEvents'))
  if (!hasContexts.value) gaps.push(t('analytics.gapContexts'))
  return gaps
})

const generatedAtLabel = computed(() => analytics.value
  ? `${t('analytics.generatedAt')} ${dateTime(analytics.value.generatedAt)}`
  : t('analytics.waiting'))

/**
 * 提示词长度的展示串。
 *
 * 放在 computed 而不是模板里，是因为 vue-i18n 的具名插值需要传对象字面量，
 * 而模板对多行对象字面量的解析会失败（它把 { 当块语句起始）——单行硬塞可读性
 * 又太差，所以在这里组装。
 */
/**
 * 引用方式的构成条。
 *
 * 两个数可能重叠（同一张参考图既可被 @ 提及也可被连线引入），所以按并列条形
 * 展示而不是堆叠，宽度用两者中的较大值归一。
 */
const referenceBreakdown = computed(() => [
  { key: 'mentioned', label: t('analytics.averageMentioned'), value: analytics.value?.contexts.averageMentionedReferences ?? 0 },
  { key: 'connected', label: t('analytics.averageConnected'), value: analytics.value?.contexts.averageConnectedReferences ?? 0 },
])

const referenceBreakdownMax = computed(() => Math.max(1, ...referenceBreakdown.value.map(row => row.value)))

const promptCharsLabel = computed(() => t('analytics.promptCharsValue', {
  average: nullableNumber(analytics.value?.contexts.averagePromptChars),
  p50: nullableNumber(analytics.value?.contexts.promptCharsP50),
  p90: nullableNumber(analytics.value?.contexts.promptCharsP90),
}))

const eventTypeTotal = computed(() => {
  const buckets = analytics.value?.events.byType ?? []
  return buckets.reduce((sum, bucket) => sum + bucket.count, 0)
})

const sourceTotal = computed(() => {
  const buckets = analytics.value?.events.bySource ?? []
  return buckets.reduce((sum, bucket) => sum + bucket.count, 0)
})

/** 占比按同一分组内的总数算——两个维度各自归一到 100%。 */
function share(count: number, total: number) {
  if (!total) return 0
  return Math.round((count / total) * 1000) / 10
}

function nullableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : String(value)
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value}%`
}

async function loadAnalytics() {
  // 用请求序号而不是 loading 闸门。
  //
  // 之前是 `if (loading.value) return`，这会让「请求进行中切换时间窗」被静默丢弃：
  // 上一次请求回来后写入的是旧窗口的数据，而按钮已经高亮到新窗口，界面于是长期
  // 显示一个与标签不符的数字。序号同时解决两件事——新请求照发不误，以及先发后到
  // 的过期响应不会覆盖更新的结果。
  const seq = ++loadSeq
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await adminApiJson<{ analytics: AdminImageAnalytics }>(
      `/api/admin/image-analytics?hours=${encodeURIComponent(windowHours.value)}`,
    )
    if (seq !== loadSeq) return
    analytics.value = data.analytics
    loadedVersion.value = props.refreshVersion ?? 0
  } catch (error) {
    if (seq !== loadSeq) return
    errorMessage.value = adminErrorMessage(error, t('feedback.analyticsFailed'))
  } finally {
    // 只有最后一次请求负责收起 loading：更早的请求结束时界面还在等新数据。
    if (seq === loadSeq) loading.value = false
  }
}

function selectWindow(hours: string) {
  if (windowHours.value === hours) return
  windowHours.value = hours
  void loadAnalytics()
}

onMounted(loadAnalytics)
onActivated(() => {
  if (loadedVersion.value !== (props.refreshVersion ?? 0)) void loadAnalytics()
})
</script>

<template>
  <div class="text-[var(--text-primary)]">
    <AdminStatusBanner v-if="errorMessage" :error="errorMessage" />

    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ t('nav.analytics') }}</h2>
        <p class="mt-0.5 text-xs text-[var(--text-muted)]">{{ generatedAtLabel }}</p>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex overflow-hidden rounded-lg border border-[var(--border)]">
          <button
            v-for="option in windowOptions"
            :key="option.hours"
            type="button"
            class="px-3 py-1.5 text-xs transition-colors"
            :class="windowHours === option.hours
              ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-soft)]'"
            @click="selectWindow(option.hours)"
          >
            {{ t(option.labelKey) }}
          </button>
        </div>
        <Button variant="outline" size="sm" :disabled="loading" @click="loadAnalytics">
          {{ t('common.refresh') }}
        </Button>
      </div>
    </div>

    <!--
      采集还没接线时两张表都是空的。这不是故障，而是配置状态：把缺口列出来，
      比显示两片空白卡片有用。
    -->
    <div
      v-if="analytics && !hasAnything"
      class="mb-4 border border-dashed border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <p class="text-sm font-medium">{{ t('analytics.emptyTitle') }}</p>
      <p class="mt-1 text-xs text-[var(--text-muted)]">{{ t('analytics.emptyHint') }}</p>
      <ul class="mt-3 space-y-1.5">
        <li
          v-for="gap in collectionGaps"
          :key="gap"
          class="flex items-start gap-2 text-xs text-[var(--text-muted)]"
        >
          <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />
          <span>{{ gap }}</span>
        </li>
      </ul>
    </div>

    <div v-else-if="analytics" class="grid items-start gap-4 lg:grid-cols-2">
      <!-- 行为事件 -->
      <section class="border border-[var(--border)] bg-[var(--surface)] p-4">
        <header class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold">{{ t('analytics.eventsTitle') }}</h3>
          <Badge v-if="analytics.events.sampled" variant="outline">{{ t('analytics.sampled') }}</Badge>
        </header>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <span class="block text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.eventsTotal') }}</span>
            <strong class="block text-lg">{{ analytics.events.total }}</strong>
          </div>
          <div>
            <span class="block text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.sessions') }}</span>
            <strong class="block text-lg">{{ analytics.events.sessions }}</strong>
          </div>
          <div>
            <span class="block text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.sessionCoverage') }}</span>
            <strong class="block text-lg">{{ percent(analytics.events.sessionCoverage) }}</strong>
          </div>
        </div>

        <div v-if="hasEvents" class="mt-4 space-y-3">
          <div>
            <p class="mb-2 text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.byType') }}</p>
            <div v-for="bucket in analytics.events.byType" :key="`type-${bucket.key}`" class="mb-1.5">
              <div class="flex items-center justify-between text-xs">
                <span>{{ bucket.key }}</span>
                <span class="text-[var(--text-muted)]">{{ bucket.count }} · {{ share(bucket.count, eventTypeTotal) }}%</span>
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full bg-border">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${share(bucket.count, eventTypeTotal)}%` }"
                />
              </div>
            </div>
          </div>

          <div>
            <p class="mb-2 text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.bySource') }}</p>
            <div v-for="bucket in analytics.events.bySource" :key="`source-${bucket.key}`" class="mb-1.5">
              <div class="flex items-center justify-between text-xs">
                <span>{{ bucket.key }}</span>
                <span class="text-[var(--text-muted)]">{{ bucket.count }} · {{ share(bucket.count, sourceTotal) }}%</span>
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full bg-border">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${share(bucket.count, sourceTotal)}%` }"
                />
              </div>
            </div>
          </div>
        </div>
        <p v-else class="mt-4 text-xs text-[var(--text-muted)]">{{ t('analytics.gapEvents') }}</p>
      </section>

      <!-- 画布上下文 -->
      <section class="border border-[var(--border)] bg-[var(--surface)] p-4">
        <header class="mb-3">
          <h3 class="text-sm font-semibold">{{ t('analytics.contextsTitle') }}</h3>
        </header>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <span class="block text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.contextsTotal') }}</span>
            <strong class="block text-lg">{{ analytics.contexts.total }}</strong>
          </div>
          <div>
            <span class="block text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.uniqueCanvases') }}</span>
            <strong class="block text-lg">{{ analytics.contexts.uniqueCanvases }}</strong>
          </div>
          <div>
            <span class="block text-[11px] uppercase text-[var(--text-muted)]">{{ t('analytics.connectedPromptRate') }}</span>
            <strong class="block text-lg">{{ percent(analytics.contexts.connectedPromptRate) }}</strong>
          </div>
        </div>

        <dl v-if="hasContexts" class="mt-4 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <dt class="text-[var(--text-muted)]">{{ t('analytics.averageNodes') }}</dt>
            <dd>{{ nullableNumber(analytics.contexts.averageNodes) }}</dd>
          </div>
          <div class="flex items-center justify-between">
            <dt class="text-[var(--text-muted)]">{{ t('analytics.averageConnections') }}</dt>
            <dd>{{ nullableNumber(analytics.contexts.averageConnections) }}</dd>
          </div>
          <div class="flex items-center justify-between">
            <dt class="text-[var(--text-muted)]">{{ t('analytics.averageReferences') }}</dt>
            <dd>{{ nullableNumber(analytics.contexts.averageReferences) }}</dd>
          </div>
          <!--
            平均参考图拆成两种引入方式：提示词里写引用、以及用连线连过来。
            两个数相加不一定等于平均值（同一张图可能两种方式都算），所以画成
            并列的构成条而不是堆叠，避免读成「合起来就是总数」。
          -->
          <div>
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[var(--text-muted)]">{{ t('analytics.referenceBreakdown') }}</span>
              <span class="text-[var(--text-muted)]">{{ t('analytics.referenceBreakdownHint') }}</span>
            </div>
            <div
              v-for="row in referenceBreakdown"
              :key="row.key"
              class="mb-1.5 grid grid-cols-[minmax(72px,110px)_minmax(0,1fr)_auto] items-center gap-2"
            >
              <span class="truncate text-[var(--text-primary)]">{{ row.label }}</span>
              <div class="h-2 overflow-hidden rounded-full bg-border">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${share(row.value, referenceBreakdownMax)}%` }"
                />
              </div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
          <div class="flex items-center justify-between gap-4 border-t border-[var(--border)] pt-2">
            <dt class="text-[var(--text-muted)]">{{ t('analytics.promptChars') }}</dt>
            <dd>{{ promptCharsLabel }}</dd>
          </div>
        </dl>
        <p v-else class="mt-4 text-xs text-[var(--text-muted)]">{{ t('analytics.gapContexts') }}</p>
      </section>
    </div>

    <div v-else-if="loading" class="border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">
      {{ t('analytics.loading') }}
    </div>
  </div>
</template>
