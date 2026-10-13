import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 图片分析聚合。
 *
 * 这两张表只有 service_role 可读，接口必须走管理端鉴权；这里只测聚合本身，
 * 用假 client 喂数据。重点覆盖三类容易算错的地方：分位数、去重、采样标记。
 */

let eventRows: Array<Record<string, unknown>> = []
let contextRows: Array<Record<string, unknown>> = []
let eventTotal = 0
let contextTotal = 0
let eventLimit: unknown = null
let contextLimit: unknown = null

function makeQuery(kind: 'events' | 'contexts') {
  const rows = () => (kind === 'events' ? eventRows : contextRows)
  const total = () => (kind === 'events' ? eventTotal : contextTotal)

  // 真实 builder（PostgrestFilterBuilder）每个方法都返回自身，可以任意链式，
  // 直到 await 才发请求。head 模式的 select 也是返回 builder，不是 promise——
  // 这一点由 @supabase/postgrest-js 的类型签名确认（select(columns, options)
  // 返回 PostgrestFilterBuilder）。所以这里统一返回 query，用 then 兑现。
  let wantsCount = false
  let wantsRows = false

  const query: Record<string, unknown> = {}

  query.select = vi.fn((_cols: string, options?: { count?: string; head?: boolean }) => {
    if (options?.head) wantsCount = true
    else wantsRows = true
    return query
  })
  query.gte = vi.fn(() => query)
  query.order = vi.fn(() => query)
  query.limit = vi.fn((value: unknown) => {
    if (kind === 'events') eventLimit = value
    else contextLimit = value
    return query
  })

  // await query 时兑现：count 查询回数量，明细查询回行。
  query.then = (resolve: (value: unknown) => unknown) => {
    if (wantsCount && !wantsRows) {
      return Promise.resolve({ data: null, count: total(), error: null }).then(resolve)
    }
    if (kind === 'events') eventLimit ??= 'unlimited'
    else contextLimit ??= 'unlimited'
    return Promise.resolve({ data: rows(), error: null }).then(resolve)
  }
  return query
}

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: { user: { id, email: `${id}@example.test` } },
          error: null,
        })),
      },
    },
    from: (table: string) => makeQuery(table === 'image_events' ? 'events' : 'contexts'),
  }),
}))

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    image_id: 'img_1',
    user_id: null,
    event_type: 'view_detail',
    source: 'works',
    session_id: 'session_a',
    created_at: '2026-10-13T00:00:00.000Z',
    ...overrides,
  }
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ctx_1',
    generation_id: 'gen_1',
    user_id: null,
    canvas_id: 'canvas_1',
    node_count: 10,
    connection_count: 4,
    image_node_count: 3,
    text_node_count: 2,
    generation_node_count: 1,
    reference_count: 2,
    mentioned_reference_count: 1,
    connected_reference_count: 1,
    prompt_char_count: 100,
    has_connected_prompt: true,
    canvas_version: 1,
    created_at: '2026-10-13T00:00:00.000Z',
    ...overrides,
  }
}

async function load() {
  vi.resetModules()
  const mod = await import('../backend/gateway/src/services/admin-image-analytics')
  return mod.getAdminImageAnalytics
}

describe('admin image analytics', () => {
  beforeEach(() => {
    eventRows = []
    contextRows = []
    eventTotal = 0
    contextTotal = 0
    eventLimit = null
    contextLimit = null
  })

  it('returns empty summaries when both tables are empty', async () => {
    const getAnalytics = await load()
    const result = await getAnalytics()

    // 空表是最可能被看到的状态（两张表都还没接线），必须不炸。
    expect(result.events.total).toBe(0)
    expect(result.events.byType).toEqual([])
    expect(result.events.sessions).toBe(0)
    expect(result.contexts.total).toBe(0)
    expect(result.contexts.averageReferences).toBeNull()
    expect(result.contexts.promptCharsP50).toBeNull()
  })

  it('does not query rows when the window is empty', async () => {
    const getAnalytics = await load()
    await getAnalytics()

    // count 为 0 时不该再去拉明细行。
    expect(eventLimit).toBeNull()
    expect(contextLimit).toBeNull()
  })

  it('tallies events by type and source, newest first', async () => {
    eventRows = [
      event({ id: 'e1', event_type: 'view_detail', source: 'works' }),
      event({ id: 'e2', event_type: 'view_detail', source: 'history' }),
      event({ id: 'e3', event_type: 'download', source: 'works' }),
      event({ id: 'e4', event_type: 'zoom', source: 'viewer' }),
    ]
    eventTotal = 4

    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.events.total).toBe(4)
    expect(result.events.byType[0]).toEqual({ key: 'view_detail', count: 2 })
    const typeKeys = result.events.byType.map(item => item.key).sort()
    expect(typeKeys).toEqual(['download', 'view_detail', 'zoom'])
    expect(result.events.bySource.find(item => item.key === 'works')?.count).toBe(2)
    // 明细按查询顺序（created_at desc）截断，id 顺序应与输入一致。
    expect(result.events.recent.map(item => item.id)).toEqual(['e1', 'e2', 'e3', 'e4'])
  })

  it('counts distinct sessions instead of raw events', async () => {
    eventRows = [
      event({ id: 'e1', session_id: 'session_a' }),
      event({ id: 'e2', session_id: 'session_a' }),
      event({ id: 'e3', session_id: 'session_b' }),
      event({ id: 'e4', session_id: null }),
    ]
    eventTotal = 4

    const getAnalytics = await load()
    const result = await getAnalytics()

    // 同一个 session 下三次点击只算一次浏览。
    expect(result.events.sessions).toBe(2)
    // 4 条里 3 条带 session → 75%。
    expect(result.events.sessionCoverage).toBe(75)
  })

  it('treats a missing event_type as unknown rather than dropping the row', async () => {
    eventRows = [
      event({ id: 'e1', event_type: null }),
      event({ id: 'e2', event_type: '' }),
      event({ id: 'e3', event_type: 'download' }),
    ]
    eventTotal = 3

    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.events.byType.find(item => item.key === 'unknown')?.count).toBe(2)
    // 总数按实际行数算，缺字段不会让计数缩水。
    expect(result.events.total).toBe(3)
  })

  it('flags sampling when the window holds more rows than the cap', async () => {
    eventRows = [event({ id: 'e1' })]
    eventTotal = 999_999

    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.events.sampled).toBe(true)
    // 分布按样本算，但 total 仍是真实总数。
    expect(result.events.total).toBe(999_999)
  })

  it('does not flag sampling when everything was read', async () => {
    eventRows = [event({ id: 'e1' }), event({ id: 'e2' })]
    eventTotal = 2

    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.events.sampled).toBe(false)
  })

  it('computes prompt length percentiles instead of only the mean', async () => {
    // 均值会被长尾带偏：4 条短提示词 + 1 条超长，均值 240 但中位数只有 100。
    contextRows = [
      context({ prompt_char_count: 100 }),
      context({ prompt_char_count: 100 }),
      context({ prompt_char_count: 100 }),
      context({ prompt_char_count: 100 }),
      context({ prompt_char_count: 800 }),
    ]
    contextTotal = 5

    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.contexts.averagePromptChars).toBe(240)
    expect(result.contexts.promptCharsP50).toBe(100)
    expect(result.contexts.promptCharsP90).toBe(800)
  })

  it('aggregates canvas workflow shape', async () => {
    contextRows = [
      context({ canvas_id: 'canvas_1', reference_count: 2, has_connected_prompt: true, node_count: 10, connection_count: 4 }),
      context({ canvas_id: 'canvas_1', reference_count: 4, has_connected_prompt: true, node_count: 20, connection_count: 8 }),
      context({ canvas_id: 'canvas_2', reference_count: 0, has_connected_prompt: false, node_count: 30, connection_count: 12 }),
    ]
    contextTotal = 3

    const getAnalytics = await load()
    const result = await getAnalytics()

    // 三行但只有两张画布：uniqueCanvases 衡量的是画布数量而非生成次数。
    expect(result.contexts.uniqueCanvases).toBe(2)
    expect(result.contexts.averageReferences).toBe(2)
    expect(result.contexts.averageNodes).toBe(20)
    expect(result.contexts.averageConnections).toBe(8)
    // 3 次里 2 次连了提示词节点。
    expect(result.contexts.connectedPromptRate).toBe(66.7)
  })

  it('distinguishes mentioned from connected references', async () => {
    contextRows = [
      context({ mentioned_reference_count: 3, connected_reference_count: 0 }),
      context({ mentioned_reference_count: 0, connected_reference_count: 5 }),
    ]
    contextTotal = 2

    const getAnalytics = await load()
    const result = await getAnalytics()

    // 两种引用方式分开统计——「@ 提及」和「连线引入」是不同的用法。
    // 平均值取整：(3+0)/2 = 1.5 → 2，(0+5)/2 = 2.5 → 3。
    expect(result.contexts.averageMentionedReferences).toBe(2)
    expect(result.contexts.averageConnectedReferences).toBe(3)
  })

  it('never reports a negative count from bad data', async () => {
    contextRows = [
      context({ reference_count: -5, prompt_char_count: 'abc' }),
      context({ reference_count: null, prompt_char_count: null }),
    ]
    contextTotal = 2

    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.contexts.averageReferences).toBe(0)
    expect(result.contexts.averagePromptChars).toBe(0)
  })

  it('caps the time window so the query cannot scan everything', async () => {
    const getAnalytics = await load()
    const result = await getAnalytics({ hours: 24 * 365 })

    // 90 天是上限，防止有人传一个巨大的窗口把表扫穿。
    expect(result.windowHours).toBe(24 * 90)
  })

  it('defaults the window to one week', async () => {
    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.windowHours).toBe(24 * 7)
  })

  it('resolves the emails of users seen in recent events', async () => {
    eventRows = [
      event({ id: 'e1', user_id: 'user_1' }),
      event({ id: 'e2', user_id: 'user_2' }),
      event({ id: 'e3', user_id: 'user_1' }),
    ]
    eventTotal = 3

    const getAnalytics = await load()
    const result = await getAnalytics()

    expect(result.users.map(user => user.id).sort()).toEqual(['user_1', 'user_2'])
    expect(result.users.every(user => user.email?.endsWith('@example.test'))).toBe(true)
  })
})
