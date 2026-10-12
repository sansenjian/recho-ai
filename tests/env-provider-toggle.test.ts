
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 环境变量兜底 Provider 的启停。
 *
 * 这几条盯的是两个容易写错的地方：停用后那行必须还在（否则管理界面没有按钮可以恢复），
 * 以及写入前读失败必须报错（否则会把别人停用的项一起抹掉）。
 */
const settingsRows = new Map<string, unknown>()
const upserts: Array<{ key: string; value: unknown }> = []
let readError: unknown = null

vi.mock('../backend/gateway/src/clients/supabase.js', () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            if (readError) throw readError
            return { data: { value: settingsRows.get(String(value)) }, error: null }
          },
        }),
      }),
      upsert: async (row: { key: string; value: unknown }) => {
        upserts.push(row)
        settingsRows.set(row.key, row.value)
        return { error: null }
      },
    }),
  }),
}))

vi.mock('../backend/gateway/src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backend/gateway/src/config.js')>()
  return {
    ...actual,
    OPENAI_API_KEY: 'sk-openai',
    OPENAI_BASE_URL: 'https://openai.example.test/v1',
    KIMI_API_KEY: 'sk-kimi',
    KIMI_BASE_URL: 'https://kimi.example.test/v1',
  }
})

describe('env provider 启停', () => {
  beforeEach(() => {
    settingsRows.clear()
    upserts.length = 0
    readError = null
  })

  it('keeps a disabled provider row so it can be turned back on', async () => {
    settingsRows.set('disabled_env_providers', ['env:chat:openai'])
    const { listProviderSettings } = await import('../backend/gateway/src/services/provider-settings.js')

    const { providers } = await listProviderSettings({ refresh: true })
    const openai = providers.find(provider => provider.id === 'env:chat:openai')

    // 行必须在：管理界面只渲染这份列表，行没了就没有按钮可以恢复。
    expect(openai).toBeDefined()
    expect(openai?.enabled).toBe(false)
    // 没被停用的那个不受影响。
    expect(providers.find(provider => provider.id === 'env:chat:kimi')?.enabled).toBe(true)
  })

  it('refuses to write when the current list cannot be read', async () => {
    readError = new Error('db down')
    const { setEnvProviderEnabled } = await import('../backend/gateway/src/services/provider-settings.js')

    // 读失败时若退化成空集合写回，会把别的管理员停用的项一起抹掉。
    await expect(
      setEnvProviderEnabled('env:chat:kimi', false, { id: 'admin-1' } as never),
    ).rejects.toThrow()
    expect(upserts).toHaveLength(0)
  })

  it('adds and removes an id without disturbing the others', async () => {
    settingsRows.set('disabled_env_providers', ['env:chat:openai'])
    const { setEnvProviderEnabled } = await import('../backend/gateway/src/services/provider-settings.js')

    await setEnvProviderEnabled('env:chat:kimi', false, { id: 'admin-1' } as never)
    expect(upserts.at(-1)?.value).toEqual(['env:chat:kimi', 'env:chat:openai'])

    await setEnvProviderEnabled('env:chat:openai', true, { id: 'admin-1' } as never)
    expect(upserts.at(-1)?.value).toEqual(['env:chat:kimi'])
  })

  it('rejects ids that are not environment providers', async () => {
    const { setEnvProviderEnabled } = await import('../backend/gateway/src/services/provider-settings.js')

    await expect(
      setEnvProviderEnabled('some-db-provider-id', false, { id: 'admin-1' } as never),
    ).rejects.toThrow()
    expect(upserts).toHaveLength(0)
  })
})
