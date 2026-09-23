import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfigFile, resolveConfig, saveConfig, removeConfig } from '../config.js'
import { CLIError } from '../types.js'

const ORIG_ENV = { baseUrl: process.env.RECHO_BASE_URL, token: process.env.RECHO_TOKEN }

afterEach(() => {
  if (ORIG_ENV.baseUrl === undefined) delete process.env.RECHO_BASE_URL
  else process.env.RECHO_BASE_URL = ORIG_ENV.baseUrl
  if (ORIG_ENV.token === undefined) delete process.env.RECHO_TOKEN
  else process.env.RECHO_TOKEN = ORIG_ENV.token
  vi.restoreAllMocks()
})

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), 'recho-test-'))
  return { dir, path: join(dir, 'config.json') }
}

describe('saveConfig / readConfigFile', () => {
  it('保存并读回 baseUrl 与 token', async () => {
    const { dir, path } = await tempConfigPath()
    try {
      await saveConfig(path, { baseUrl: 'https://example.com/', token: 'secret' })
      const file = await readConfigFile(path)
      expect(file).toEqual({ baseUrl: 'https://example.com/', token: 'secret' })
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