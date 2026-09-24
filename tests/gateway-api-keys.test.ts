import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * api-keys 的用户自助入口依赖「按 user_id 收窄」的查询：
 * - 列表必须只返回调用者自己的 key；
 * - 撤销必须带 user_id 过滤，否则用户可撤销他人的 key。
 * 这里用最小假表复现 supabase 的链式语义来锁住这两点。
 */

interface Row extends Record<string, unknown> {
  id: string
  user_id: string
  revoked_at: string | null
}

interface OrderSpec {
  column: string
  ascending: boolean
  nullsFirst: boolean
}

let rows: Row[] = []
let listError: unknown = null

function matches(row: Row, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([column, value]) => (row[column] ?? null) === value)
}

/** 复现 PostgREST 的多列排序（含 nulls first/last）语义。 */
function sortRows(source: Row[], orders: OrderSpec[]) {
  return [...source].sort((left, right) => {
    for (const { column, ascending, nullsFirst } of orders) {
      const a = left[column] ?? null
      const b = right[column] ?? null
      if (a === b) continue
      if (a === null) return nullsFirst ? -1 : 1
      if (b === null) return nullsFirst ? 1 : -1
      const compared = String(a) < String(b) ? -1 : 1
      return ascending ? compared : -compared
    }
    return 0
  })
}

function makeSelectBuilder(options: { count?: string; head?: boolean } = {}) {
  const filters: Record<string, unknown> = {}
  const orders: OrderSpec[] = []
  let max: number | null = null
  const builder = {
    order: vi.fn((column: string, orderOptions: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
      orders.push({
        column,
        ascending: orderOptions.ascending !== false,
        nullsFirst: orderOptions.nullsFirst === true,
      })
      return builder
    }),
    limit: vi.fn((value: number) => {
      max = value
      return builder
    }),
    eq: vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    }),
    is: vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    }),
    then: (
      resolve: (value: { data: Row[] | null; count: number; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const matched = sortRows(rows.filter(row => matches(row, filters)), orders)
      const payload = listError
        ? { data: [] as Row[], count: 0, error: listError }
        : options.head
          ? { data: null, count: matched.length, error: null }
          : { data: max === null ? matched : matched.slice(0, max), count: matched.length, error: null }
      return Promise.resolve(payload).then(resolve, reject)
    },
  }
  return builder
}

function makeInsertBuilder(payload: Record<string, unknown>) {
  const created = { id: `key-created-${rows.length + 1}`, created_at: '2026-09-10T00:00:00.000Z', ...payload } as Row
  rows.push(created)
  const builder = {
    select: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: created, error: null })),
  }
  return builder
}

function makeUpdateBuilder(payload: Record<string, unknown>) {
  const filters: Record<string, unknown> = {}
  const builder = {
    eq: vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    }),
    is: vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    }),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      const target = rows.find(row => matches(row, filters))
      if (!target) return { data: null, error: null }
      Object.assign(target, payload)
      return { data: { id: target.id }, error: null }
    }),
  }
  return builder
}

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'api_keys') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn((_columns?: string, options?: { count?: string; head?: boolean }) => makeSelectBuilder(options)),
        insert: vi.fn((payload: Record<string, unknown>) => makeInsertBuilder(payload)),
        update: vi.fn((payload: Record<string, unknown>) => makeUpdateBuilder(payload)),
      }
    },
  }),
}))

const { ApiKeyLimitError, MAX_ACTIVE_KEYS_PER_USER, createApiKey, listApiKeys, revokeApiKey } =
  await import('../backend/gateway/src/services/api-keys')

function seedRows() {
  rows = [
    {
      id: 'key-alice',
      user_id: 'user-alice',
      name: 'alice-cli',
      key_hash: 'hash-alice',
      key_hint: 'rk-aaaa…0001',
      enabled: true,
      revoked_at: null,
      last_used_at: null,
      created_at: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'key-bob',
      user_id: 'user-bob',
      name: 'bob-cli',
      key_hash: 'hash-bob',
      key_hint: 'rk-bbbb…0002',
      enabled: true,
      revoked_at: null,
      last_used_at: null,
      created_at: '2026-09-02T00:00:00.000Z',
    },
  ]
}

beforeEach(() => {
  listError = null
  seedRows()
})

describe('listApiKeys', () => {
  it('不带 userId(管理入口)时返回全部用户的 key', async () => {
    const keys = await listApiKeys()
    expect(keys.map(key => key.id)).toEqual(['key-bob', 'key-alice'])
  })

  it('带 userId 时只返回该用户自己的 key', async () => {
    const keys = await listApiKeys('user-bob')
    expect(keys.map(key => key.id)).toEqual(['key-bob'])
  })

  it('未撤销的 key 排在已撤销的 key 之前', async () => {
    // 撤销记录比有效 key 更新:不排序的话有效 key 会被挤到列表后面
    rows.push({
      id: 'key-alice-revoked',
      user_id: 'user-alice',
      name: 'alice-revoked',
      key_hash: 'hash-alice-revoked',
      revoked_at: '2026-09-05T00:00:00.000Z',
      created_at: '2026-09-05T00:00:00.000Z',
    })
    const keys = await listApiKeys('user-alice')
    expect(keys.map(key => key.id)).toEqual(['key-alice', 'key-alice-revoked'])
  })

  it('查询失败时返回空列表且不抛错', async () => {
    listError = { message: 'boom' }
    await expect(listApiKeys('user-alice')).resolves.toEqual([])
  })
})

describe('createApiKey', () => {
  function seedKeys(userId: string, count: number, revokedAt: string | null) {
    rows = Array.from({ length: count }, (_, index) => ({
      id: `key-${userId}-${index}`,
      user_id: userId,
      name: `key-${index}`,
      key_hash: `hash-${userId}-${index}`,
      revoked_at: revokedAt,
      created_at: '2026-09-01T00:00:00.000Z',
    }))
  }

  it('未达到上限时可以签发', async () => {
    const { record, issued } = await createApiKey('user-alice', 'alice-cli-2')
    expect(record.user_id).toBe('user-alice')
    expect(issued.plain.startsWith('rk-')).toBe(true)
    expect(rows.filter(row => row.user_id === 'user-alice')).toHaveLength(2)
  })

  it('有效 key 达到上限时拒绝签发', async () => {
    seedKeys('user-alice', MAX_ACTIVE_KEYS_PER_USER, null)
    await expect(createApiKey('user-alice', 'one-too-many')).rejects.toBeInstanceOf(ApiKeyLimitError)
    expect(rows).toHaveLength(MAX_ACTIVE_KEYS_PER_USER)
  })

  it('上限只统计未撤销的 key', async () => {
    seedKeys('user-alice', MAX_ACTIVE_KEYS_PER_USER + 5, '2026-09-02T00:00:00.000Z')
    const { record } = await createApiKey('user-alice', 'fresh')
    expect(record.user_id).toBe('user-alice')
  })

  it('上限只统计调用者自己的 key', async () => {
    seedKeys('user-bob', MAX_ACTIVE_KEYS_PER_USER, null)
    const { record } = await createApiKey('user-alice', 'alice-only')
    expect(record.user_id).toBe('user-alice')
  })

  it('上限错误带 409 与可展示文案', () => {
    const error = new ApiKeyLimitError()
    expect(error.status).toBe(409)
    expect(error.publicMessage).toContain('撤销')
  })
})

describe('revokeApiKey', () => {
  it('带 userId 时可以撤销自己的 key', async () => {
    await expect(revokeApiKey('key-alice', 'user-alice')).resolves.toBe(true)
    expect(rows.find(row => row.id === 'key-alice')?.revoked_at).toBeTruthy()
  })

  it('带 userId 时无法撤销他人的 key', async () => {
    await expect(revokeApiKey('key-bob', 'user-alice')).resolves.toBe(false)
    expect(rows.find(row => row.id === 'key-bob')?.revoked_at).toBeNull()
  })

  it('不带 userId(管理入口)时可撤销任意用户的 key', async () => {
    await expect(revokeApiKey('key-bob')).resolves.toBe(true)
    expect(rows.find(row => row.id === 'key-bob')?.revoked_at).toBeTruthy()
  })

  it('已撤销的 key 不再重复撤销', async () => {
    rows[0].revoked_at = '2026-09-03T00:00:00.000Z'
    await expect(revokeApiKey('key-alice', 'user-alice')).resolves.toBe(false)
  })
})