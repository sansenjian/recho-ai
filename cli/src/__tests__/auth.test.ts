import { describe, it, expect, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePkcePair, toBase64Url, exchangePkce, refreshAccessToken, getAccessToken } from '../auth.js'
import { saveConfig, readConfigFile } from '../config.js'
import { CLIError, type ResolvedCLIConfig } from '../types.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), 'recho-auth-test-'))
  return { dir, path: join(dir, 'config.json') }
}

function tokenResponse(overrides: Partial<{ access_token: string; refresh_token: string; expires_in: number }> = {}) {
  return JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, ...overrides })
}

function cfg(overrides: Partial<ResolvedCLIConfig> = {}): ResolvedCLIConfig {
  return {
    baseUrl: 'https://site.example.com',
    token: 'at-1',
    configPath: '/tmp/nonexistent/config.json',
    ...overrides,
  }
}

describe('PKCE 工具', () => {
  it('verifier 与 S256 challenge 可复现且一致', () => {
    const seed = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8') // 32 字节
    const first = generatePkcePair(seed)
    const second = generatePkcePair(seed)
    expect(first.verifier).toBe(second.verifier)
    expect(first.challenge).toBe(second.challenge)
    const expectedChallenge = toBase64Url(createHash('sha256').update(first.verifier, 'utf8').digest())
    expect(first.challenge).toBe(expectedChallenge)
  })

  it('base64url 编码不带填充', () => {
    expect(toBase64Url(Buffer.from('a'))) // 1 字节 → "YQ",无 '='
      .toBe('YQ')
    expect(toBase64Url(Buffer.from('ab'))).toBe('YWI')
  })
})

describe('exchangePkce', () => {
  it('构造 pkce token 请求并映射 session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(tokenResponse(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const session = await exchangePkce('https://db.supabase.co', 'anon-key', 'the-code', 'the-verifier')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://db.supabase.co/auth/v1/token?grant_type=pkce')
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' })
    expect(JSON.parse(String(init.body))).toEqual({ auth_code: 'the-code', code_verifier: 'the-verifier' })
    expect(session).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' })
    expect(session.expiresAt).toBeGreaterThan(Date.now())
  })

  it('失败归一为退出码 4', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(tokenResponse({ access_token: undefined }), { status: 400 })))
    await expect(exchangePkce('https://db.supabase.co', 'k', 'c', 'v')).rejects.toMatchObject({ exitCode: 4 })
  })
})

describe('refreshAccessToken', () => {
  it('成功后返回新 session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(tokenResponse(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const session = await refreshAccessToken('https://db.supabase.co', 'anon', 'rt-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://db.supabase.co/auth/v1/token?grant_type=refresh_token')
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: 'rt-1' })
    expect(session.refreshToken).toBe('rt-2')
  })

  it('400 invalid_grant → CLIError 4', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(refreshAccessToken('https://db.supabase.co', 'anon', 'rt-expired')).rejects.toMatchObject({
      exitCode: 4,
      code: 'AUTH_FAILED',
    })
  })
})

describe('getAccessToken', () => {
  it('无 token → 未登录(3)', async () => {
    await expect(getAccessToken(cfg({ token: null }))).rejects.toMatchObject({ exitCode: 3 })
  })

  it('旧格式 token-only(无 refreshToken)不刷新,原样返回', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const result = await getAccessToken(cfg({ refreshToken: undefined, expiresAt: undefined }))
    expect(result).toBe('at-1')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('未过期直接返回,不发请求', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const future = Date.now() + 60 * 60 * 1000
    const result = await getAccessToken(cfg({ refreshToken: 'rt', expiresAt: future, supabaseUrl: 'https://db.supabase.co', anonKey: 'anon' }))
    expect(result).toBe('at-1')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('过期时自动刷新并回写配置文件', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await saveConfig(path, { baseUrl: 'https://site.example.com', accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() - 1000, supabaseUrl: 'https://db.supabase.co', anonKey: 'anon' })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(tokenResponse(), { status: 200 })))

      const result = await getAccessToken(cfg({ refreshToken: 'rt-1', expiresAt: Date.now() - 1000, supabaseUrl: 'https://db.supabase.co', anonKey: 'anon', configPath: path }))

      expect(result).toBe('at-2')
      const file = JSON.parse(await readFile(path, 'utf8'))
      expect(file.accessToken).toBe('at-2')
      expect(file.refreshToken).toBe('rt-2')
      expect(typeof file.expiresAt).toBe('number')
      expect(file.baseUrl).toBe('https://site.example.com')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supabase 配置缺失时走公共端点回退', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await saveConfig(path, { baseUrl: 'https://site.example.com', accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() - 1000 })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, url: 'https://db.supabase.co', publishableKey: 'anon' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(tokenResponse(), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await getAccessToken(cfg({ refreshToken: 'rt-1', expiresAt: Date.now() - 1000, configPath: path }))
      expect(result).toBe('at-2')
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://site.example.com/api/config/supabase', expect.anything())
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://db.supabase.co/auth/v1/token?grant_type=refresh_token', expect.anything())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('刷新失败(令牌失效)抛退出码 4', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }), { status: 400 })))
    await expect(
      getAccessToken(cfg({ refreshToken: 'rt-dead', expiresAt: Date.now() - 1000, supabaseUrl: 'https://db.supabase.co', anonKey: 'anon' })),
    ).rejects.toBeInstanceOf(CLIError)
  })
})