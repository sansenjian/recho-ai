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

let rows: Row[] = []
let listError: unknown = null

function matches(row: Row, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([column, value]) => (row[column] ?? null) === value)
}

function makeSelectBuilder() {
  const filters: Record<string, unknown> = {}
  const builder = {
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    }),
    then: (
      resolve: (value: { data: Row[]; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(
      listError
        ? { data: [] as Row[], error: listError }
        : { data: rows.filter(row => matches(row, filters)), error: null },
    ).then(resolve, reject),
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
        select: vi.fn(() => makeSelectBuilder()),
        update: vi.fn((payload: Record<string, unknown>) => makeUpdateBuilder(payload)),
      }
    },
  }),
}))

const { listApiKeys, revokeApiKey } = await import('../backend/gateway/src/services/api-keys')

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
    expect(keys.map(key => key.id)).toEqual(['key-alice', 'key-bob'])
  })

  it('带 userId 时只返回该用户自己的 key', async () => {
    const keys = await listApiKeys('user-bob')
    expect(keys.map(key => key.id)).toEqual(['key-bob'])
  })

  it('查询失败时返回空列表且不抛错', async () => {
    listError = { message: 'boom' }
    await expect(listApiKeys('user-alice')).resolves.toEqual([])
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