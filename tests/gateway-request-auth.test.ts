import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 身份解析对 rk- 密钥要顺手回写 last_used_at（与 Go 网关同一语义）：
 * 回写是旁路——不 await、失败只记日志，绝不能影响鉴权结果。
 */

const state = vi.hoisted(() => ({
  lookup: vi.fn(),
  touch: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('../backend/gateway/src/services/api-keys', () => ({
  hashApiKey: (plain: string) => `hash:${plain}`,
  lookupKeyUser: state.lookup,
  touchLastUsed: state.touch,
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({ auth: { getUser: state.getUser } }),
}))

const { getRequestUser } = await import('../backend/gateway/src/services/request-auth')

/** 只实现 request-auth 真正用到的那一个方法：req.get('authorization')。 */
function fakeRequest(authorization?: string) {
  return {
    get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
  } as never
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  state.lookup.mockReset()
  state.touch.mockReset().mockResolvedValue(undefined)
  state.getUser.mockReset()
})

afterEach(() => {
  warn.mockRestore()
})

describe('getRequestUser 的 rk- 密钥路径', () => {
  it('解析出用户,并异步回写最近使用时间', async () => {
    state.lookup.mockResolvedValue({ id: 'user-1', email: null, keyId: 'key-1' })

    const user = await getRequestUser(fakeRequest('Bearer rk-live-abc'))

    expect(user).toEqual({ id: 'user-1', email: null, keyId: 'key-1' })
    expect(state.lookup).toHaveBeenCalledWith('hash:rk-live-abc')
    await settle()
    expect(state.touch).toHaveBeenCalledWith('key-1')
  })

  it('回写失败不影响鉴权结果', async () => {
    state.lookup.mockResolvedValue({ id: 'user-1', email: null, keyId: 'key-1' })
    state.touch.mockRejectedValue(new Error('boom'))

    await expect(getRequestUser(fakeRequest('Bearer rk-live-abc'))).resolves.toMatchObject({ id: 'user-1' })
    await settle()
    expect(warn).toHaveBeenCalled()
  })

  it('无效密钥返回 null 且不回写', async () => {
    state.lookup.mockResolvedValue(null)

    await expect(getRequestUser(fakeRequest('Bearer rk-dead'))).resolves.toBeNull()
    await settle()
    expect(state.touch).not.toHaveBeenCalled()
  })
})

describe('getRequestUser 的 Supabase token 路径', () => {
  it('返回用户且不回写 last_used_at', async () => {
    state.getUser.mockResolvedValue({ data: { user: { id: 'user-2', email: 'a@b.c' } }, error: null })

    await expect(getRequestUser(fakeRequest('Bearer sb-token'))).resolves.toEqual({ id: 'user-2', email: 'a@b.c' })
    await settle()
    expect(state.lookup).not.toHaveBeenCalled()
    expect(state.touch).not.toHaveBeenCalled()
  })

  it('没有 Authorization 头时直接返回 null', async () => {
    await expect(getRequestUser(fakeRequest())).resolves.toBeNull()
    await settle()
    expect(state.getUser).not.toHaveBeenCalled()
  })
})
