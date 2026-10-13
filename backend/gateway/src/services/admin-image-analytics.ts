import { getSupabaseAdminClient } from '../clients/supabase.js'
import { cachedAdminUsersById, type AdminUserSummary } from './admin-user-cache.js'
import { redactSensitiveText } from './safe-error.js'

/**
 * 图片分析数据的只读查询。
 *
 * 这两张表（image_events / image_generation_contexts）是网关侧的分析表，只有
 * service_role 能读——RLS 里 anon 和 authenticated 都被 revoke 了。这里走的
 * 就是 service_role 客户端。
 *
 * 表本身不带聚合视图，Supabase JS 也不支持 group by，所以沿用
 * admin-image-attempts 的做法：按时间窗拉有限行，在 Node 侧汇总。关键是
 * 必须封顶，否则这个接口会随事件量线性变慢。
 */

const IMAGE_EVENTS_TABLE = 'image_events'
const IMAGE_CONTEXTS_TABLE = 'image_generation_contexts'

const DEFAULT_HOURS = 24 * 7
const MAX_HOURS = 24 * 90
/** 单次最多读多少行。分析面板看的是分布趋势，不需要精确的全量统计。 */
const MAX_ROWS = 5000
/** 明细列表只展示最近这些条。 */
const RECENT_LIMIT = 20

const EVENT_COLUMNS = ['id', 'image_id', 'user_id', 'event_type', 'source', 'session_id', 'created_at'].join(',')

const CONTEXT_COLUMNS = [
  'id',
  'generation_id',
  'user_id',
  'canvas_id',
  'node_count',
  'connection_count',
  'image_node_count',
  'text_node_count',
  'generation_node_count',
  'reference_count',
  'mentioned_reference_count',
  'connected_reference_count',
  'prompt_char_count',
  'has_connected_prompt',
  'canvas_version',
  'created_at',
].join(',')

export class AdminImageAnalyticsError extends Error {
  status: number
  publicMessage: string

  constructor(code: string, options: { status?: number; publicMessage?: string } = {}) {
    super(code)
    this.status = options.status ?? 400
    this.publicMessage = options.publicMessage ?? publicMessageForAnalyticsError(code)
  }
}

function publicMessageForAnalyticsError(code: string) {
  if (code === 'analytics_service_unavailable') return '图片分析服务暂时不可用。'
  if (code === 'analytics_query_failed') return '图片分析数据加载失败，请稍后重试。'
  return '图片分析请求无效。'
}

function requireAnalyticsClient() {
  const client = getSupabaseAdminClient()
  if (!client) {
    throw new AdminImageAnalyticsError('analytics_service_unavailable', { status: 503 })
  }
  return client
}

function sanitizedHours(value: unknown) {
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_HOURS
  return Math.min(Math.floor(hours), MAX_HOURS)
}

function sinceIso(hours: number) {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

function safeCount(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

/**
 * 取一个可安全展示的短字符串。
 *
 * 与 admin-image-attempts 里的同名私有函数保持一致：过一遍脱敏、压平空白、
 * 截断长度。事件表里不该有提示词（写入端已过滤），但这里仍然不信任存储内容。
 */
function safeDisplayText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim()) return null
  return redactSensitiveText(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength) || null
}

function ratio(part: number, total: number) {
  return total ? Math.round((part / total) * 1000) / 10 : 0
}

/** 求分位数。用于提示词长度、参考图用量这类分布指标——平均值会被长尾带偏。 */
function percentile(values: number[], p: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function average(values: number[]) {
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export interface AdminImageAnalyticsEventBucket {
  key: string
  count: number
}

export interface AdminImageAnalyticsRecentEvent {
  id: string
  eventType: string
  source: string
  imageId: string | null
  sessionId: string | null
  createdAt: string | null
}

export interface AdminImageAnalyticsOverview {
  events: {
    total: number
    byType: AdminImageAnalyticsEventBucket[]
    bySource: AdminImageAnalyticsEventBucket[]
    /** 去重后的会话数：同一个 sessionId 下多个事件算一次浏览。 */
    sessions: number
    /** 有 sessionId 的事件占比。老数据可能没有该字段，缺它时这个值会偏低。 */
    sessionCoverage: number
    recent: AdminImageAnalyticsRecentEvent[]
    /** 采样上限：true 表示窗口内事件多于 MAX_ROWS，分布是按样本算的。 */
    sampled: boolean
  }
  contexts: {
    total: number
    uniqueCanvases: number
    /** 平均每张画布用了多少张参考图。 */
    averageReferences: number | null
    /** @ 提及 / 连线引入 两种引用方式各自的平均值。 */
    averageMentionedReferences: number | null
    averageConnectedReferences: number | null
    averagePromptChars: number | null
    promptCharsP50: number | null
    promptCharsP90: number | null
    /** 连了提示词节点的生成占比——衡量画布「连线写提示词」这个用法普及度。 */
    connectedPromptRate: number
    averageNodes: number | null
    averageConnections: number | null
  }
  users: AdminUserSummary[]
  windowHours: number
  generatedAt: string
}

/** 按 key 计数并降序排列，取前 limit 项。key 为空时归到 'unknown'。 */
function tally(rows: Array<Record<string, unknown>>, column: string, limit: number) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = safeDisplayText(row[column], 60) || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, limit)
}

async function loadEvents(client: ReturnType<typeof requireAnalyticsClient>, hours: number) {
  // 先取总数（count 查询很轻），再决定是否要拉明细行。
  const totalResult = await client
    .from(IMAGE_EVENTS_TABLE)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceIso(hours))

  if (totalResult.error) throw new AdminImageAnalyticsError('analytics_query_failed', { status: 500 })
  const total = safeCount(totalResult.count)

  if (!total) {
    return { rows: [] as Array<Record<string, unknown>>, total, sampled: false }
  }

  const { data, error } = await client
    .from(IMAGE_EVENTS_TABLE)
    .select(EVENT_COLUMNS)
    .gte('created_at', sinceIso(hours))
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  if (error) throw new AdminImageAnalyticsError('analytics_query_failed', { status: 500 })

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  return { rows, total, sampled: total > rows.length }
}

async function loadContexts(client: ReturnType<typeof requireAnalyticsClient>, hours: number) {
  const totalResult = await client
    .from(IMAGE_CONTEXTS_TABLE)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceIso(hours))

  if (totalResult.error) throw new AdminImageAnalyticsError('analytics_query_failed', { status: 500 })
  const total = safeCount(totalResult.count)

  if (!total) return { rows: [] as Array<Record<string, unknown>>, total }

  const { data, error } = await client
    .from(IMAGE_CONTEXTS_TABLE)
    .select(CONTEXT_COLUMNS)
    .gte('created_at', sinceIso(hours))
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  if (error) throw new AdminImageAnalyticsError('analytics_query_failed', { status: 500 })

  return { rows: (data ?? []) as unknown as Array<Record<string, unknown>>, total }
}

function summarizeEvents(rows: Array<Record<string, unknown>>, total: number, sampled: boolean) {
  const sessions = new Set<string>()
  let withSession = 0
  for (const row of rows) {
    const sessionId = safeDisplayText(row.session_id, 80)
    if (!sessionId) continue
    withSession += 1
    sessions.add(sessionId)
  }

  const recent = rows.slice(0, RECENT_LIMIT).map(row => ({
    id: safeDisplayText(row.id, 64) || '',
    eventType: safeDisplayText(row.event_type, 40) || 'unknown',
    source: safeDisplayText(row.source, 40) || 'unknown',
    imageId: safeDisplayText(row.image_id, 64) || null,
    sessionId: safeDisplayText(row.session_id, 80) || null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  }))

  return {
    total,
    byType: tally(rows, 'event_type', 8),
    bySource: tally(rows, 'source', 5),
    sessions: sessions.size,
    sessionCoverage: ratio(withSession, rows.length),
    recent,
    sampled,
  }
}

function summarizeContexts(rows: Array<Record<string, unknown>>, total: number) {
  if (!rows.length) {
    return {
      total,
      uniqueCanvases: 0,
      averageReferences: null,
      averageMentionedReferences: null,
      averageConnectedReferences: null,
      averagePromptChars: null,
      promptCharsP50: null,
      promptCharsP90: null,
      connectedPromptRate: 0,
      averageNodes: null,
      averageConnections: null,
    }
  }

  const canvases = new Set<string>()
  const references: number[] = []
  const mentioned: number[] = []
  const connected: number[] = []
  const promptChars: number[] = []
  const nodes: number[] = []
  const connections: number[] = []
  let withConnectedPrompt = 0

  for (const row of rows) {
    const canvasId = safeDisplayText(row.canvas_id, 80)
    if (canvasId) canvases.add(canvasId)

    references.push(safeCount(row.reference_count))
    mentioned.push(safeCount(row.mentioned_reference_count))
    connected.push(safeCount(row.connected_reference_count))
    promptChars.push(safeCount(row.prompt_char_count))
    nodes.push(safeCount(row.node_count))
    connections.push(safeCount(row.connection_count))
    if (row.has_connected_prompt === true) withConnectedPrompt += 1
  }

  return {
    total,
    uniqueCanvases: canvases.size,
    averageReferences: average(references),
    averageMentionedReferences: average(mentioned),
    averageConnectedReferences: average(connected),
    averagePromptChars: average(promptChars),
    promptCharsP50: percentile(promptChars, 50),
    promptCharsP90: percentile(promptChars, 90),
    connectedPromptRate: ratio(withConnectedPrompt, rows.length),
    averageNodes: average(nodes),
    averageConnections: average(connections),
  }
}

export async function getAdminImageAnalytics(options: { hours?: unknown } = {}): Promise<AdminImageAnalyticsOverview> {
  const client = requireAnalyticsClient()
  const hours = sanitizedHours(options.hours)

  const [eventsResult, contextsResult] = await Promise.all([
    loadEvents(client, hours),
    loadContexts(client, hours),
  ])

  // 最近事件里出现的用户，用现成的缓存服务换出邮箱，避免前端再发一轮请求。
  // cachedAdminUsersById 返回 Map，转成数组下发。
  const userIds = Array.from(new Set(
    eventsResult.rows
      .slice(0, RECENT_LIMIT)
      .map(row => safeDisplayText(row.user_id, 64))
      .filter((id): id is string => Boolean(id)),
  ))
  const userMap = userIds.length ? await cachedAdminUsersById(client, userIds) : new Map<string, AdminUserSummary>()
  const users = Array.from(userMap.values())

  return {
    events: summarizeEvents(eventsResult.rows, eventsResult.total, eventsResult.sampled),
    contexts: summarizeContexts(contextsResult.rows, contextsResult.total),
    users,
    windowHours: hours,
    generatedAt: new Date().toISOString(),
  }
}

export const IMAGE_ANALYTICS_ROW_CAP = MAX_ROWS
