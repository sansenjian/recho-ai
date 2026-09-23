import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfigFile, resolveConfig, saveConfig, removeConfig, updateSession } from '../config.js'
import { CLIError } from '../types.js'

const ORIG_ENV = {
  baseUrl: process.env.RECHO_BASE_URL,
  token: process.env.RECHO_TOKEN,
  apiKey: process.env.RECHO_API_KEY,
}

afterEach(() => {
  if (ORIG_ENV.baseUrl === undefined) delete process.env.RECHO_BASE_URL
  else process.env.RECHO_BASE_URL = ORIG_ENV.baseUrl
  if (ORIG_ENV.token === undefined) delete process.env.RECHO_TOKEN
  else process.env.RECHO_TOKEN = ORIG_ENV.token
  if (ORIG_ENV.apiKey === undefined) delete process.env.RECHO_API_KEY
  else process.env.RECHO_API_KEY = ORIG_ENV.apiKey
  vi.restoreAllMocks()
})

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), 'recho-test-'))
  return { dir, path: join(dir, 'config.json') }
}

describe('saveConfig / readConfigFile', () => {
  it('直登模式(token)保存后统一读作 accessToken', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await saveConfig(path, { baseUrl: 'https://example.com/', token: 'secret' })
      const file = await readConfigFile(path)
      expect(file).toMatchObject({ baseUrl: 'https://example.com/', accessToken: 'secret' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('会话模式(accessToken/refreshToken/expiresAt)完整落盘与读回', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await saveConfig(path, {
        baseUrl: 'https://example.com',
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 1_800_000_000_000,
        supabaseUrl: 'https://db.supabase.co',
        anonKey: 'anon',
      })
      const file = await readConfigFile(path)
      expect(file).toMatchObject({
        baseUrl: 'https://example.com',
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 1_800_000_000_000,
        supabaseUrl: 'https://db.supabase.co',
        anonKey: 'anon',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('兼容旧格式 {baseUrl, token}', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await saveConfig(path, { baseUrl: 'https://example.com', token: 'old-token' })
      const file = await readConfigFile(path)
      expect(file.accessToken).toBe('old-token')
      expect(file.refreshToken).toBeUndefined()
      expect(file.expiresAt).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('不存在的配置文件返回空对象', async () => {
    const { dir, path } = await tempConfigPath()
    expect(await readConfigFile(join(dir, 'nope.json'))).toEqual({})
    await rm(dir, { recursive: true, force: true })
  })
})

describe('updateSession', () => {
  it('仅替换令牌段并保留 baseUrl 等字段', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await saveConfig(path, { baseUrl: 'https://example.com', token: 'old-at', supabaseUrl: 'https://db.supabase.co', anonKey: 'anon' })
      await updateSession(path, { accessToken: 'new-at', refreshToken: 'new-rt', expiresAt: 111 })
      const file = await readConfigFile(path)
      expect(file.accessToken).toBe('new-at')
      expect(file.refreshToken).toBe('new-rt')
      expect(file.baseUrl).toBe('https://example.com')
      expect(file.supabaseUrl).toBe('https://db.supabase.co')
      const raw = JSON.parse(await readFile(path, 'utf8'))
      expect(raw.accessToken).toBe('new-at')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('旧格式 {token} 文件经 updateSession 后转为新结构', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await writeFile(path, `${JSON.stringify({ baseUrl: 'https://example.com', token: 'old-at' })}\n`)
      await updateSession(path, { accessToken: 'new-at', refreshToken: 'new-rt', expiresAt: 111 })
      const raw = JSON.parse(await readFile(path, 'utf8'))
      expect(raw.token).toBeUndefined()
      expect(raw.accessToken).toBe('new-at')
      expect(raw.refreshToken).toBe('new-rt')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveConfig 优先级', () => {
  it('flag 优先于环境变量与配置文件', async () => {
    process.env.RECHO_BASE_URL = 'https://env.example.com'
    process.env.RECHO_TOKEN = 'env-token'
    const cfg = resolveConfig(
      { baseUrl: 'https://flag.example.com/', token: 'flag-token' },
      { baseUrl: 'https://file.example.com', token: 'file-token' },
    )
    expect(cfg.baseUrl).toBe('https://flag.example.com')
    expect(cfg.token).toBe('flag-token')
  })

  it('环境变量优先于配置文件', () => {
    process.env.RECHO_BASE_URL = 'https://env.example.com'
    const cfg = resolveConfig({}, { baseUrl: 'https://file.example.com', token: 'file-token' })
    expect(cfg.baseUrl).toBe('https://env.example.com')
    expect(cfg.token).toBe('file-token')
  })

  it('仅配置文件可用时取自配置文件,并去除末尾斜杠', () => {
    const cfg = resolveConfig({}, { baseUrl: 'https://file.example.com/', token: 'file-token' })
    expect(cfg.baseUrl).toBe('https://file.example.com')
    expect(cfg.token).toBe('file-token')
  })

  it('无任何来源时抛出 NOT_LOGGED_IN(退出码 3)', () => {
    expect(() => resolveConfig({})).toThrow(CLIError)
    try {
      resolveConfig({})
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError)
      expect((err as CLIError).exitCode).toBe(3)
      expect((err as CLIError).code).toBe('NOT_LOGGED_IN')
    }
  })

  it('非法 baseUrl 被拒绝', () => {
    expect(() => resolveConfig({ baseUrl: 'example.com' })).toThrow(/http/)
  })

  it('apiKey 优先于 token 与 env,且 token 置空', () => {
    process.env.RECHO_TOKEN = 'env-token'
    process.env.RECHO_API_KEY = 'env-rk'
    const cfg = resolveConfig({ baseUrl: 'https://x.example.com', apiKey: 'flag-rk', token: 'flag-token' }, { apiKey: 'file-rk', token: 'file-token' })
    expect(cfg.apiKey).toBe('flag-rk')
    expect(cfg.token).toBeNull()
  })

  it('apiKey 支持 env > 文件,启用后不解析 token', () => {
    process.env.RECHO_API_KEY = 'env-rk'
    const cfg = resolveConfig({ baseUrl: 'https://x.example.com' }, { apiKey: 'file-rk', accessToken: 'file-at' })
    expect(cfg.apiKey).toBe('env-rk')
    expect(cfg.token).toBeNull()
  })

  it('无 apiKey 时仍按原 token 优先级解析', () => {
    const cfg = resolveConfig({ baseUrl: 'https://x.example.com' }, { accessToken: 'file-at' })
    expect(cfg.apiKey).toBeUndefined()
    expect(cfg.token).toBe('file-at')
  })
})

describe('removeConfig', () => {
  it('删除存在的配置返回 true', async () => {
    const { dir, path } = await tempConfigPath()
    await saveConfig(path, { baseUrl: 'https://x.com', token: 't' })
    expect(await removeConfig(path)).toBe(true)
    expect(await readConfigFile(path)).toEqual({})
    await rm(dir, { recursive: true, force: true })
  })

  it('删除不存在的配置返回 true(幂等)', async () => {
    const { dir, path } = await tempConfigPath()
    expect(await removeConfig(path)).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })
})