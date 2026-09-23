import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises'
import {
  CLIError,
  EXIT_NOT_LOGGED_IN,
  EXIT_GENERIC,
  type CLIConfigFile,
  type CLISession,
  type ResolvedCLIConfig,
} from './types.js'

/** 默认配置文件路径:~/.recho/config.json */
export function defaultConfigPath(): string {
  return join(homedir(), '.recho', 'config.json')
}

export interface ConfigInput {
  baseUrl?: string | undefined
  token?: string | undefined
  configPath?: string | undefined
}

export async function readConfigFile(configPath: string): Promise<CLIConfigFile> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const obj = parsed as Record<string, unknown>
    const expiresAt = typeof obj.expiresAt === 'number' ? obj.expiresAt : undefined
    return {
      baseUrl: typeof obj.baseUrl === 'string' && obj.baseUrl ? obj.baseUrl : undefined,
      token: typeof obj.token === 'string' && obj.token ? obj.token : undefined,
      // 兼容旧格式 {baseUrl, token}:统一落到 accessToken
      accessToken:
        (typeof obj.accessToken === 'string' && obj.accessToken ? obj.accessToken : undefined) ??
        (typeof obj.token === 'string' && obj.token ? obj.token : undefined),
      refreshToken: typeof obj.refreshToken === 'string' && obj.refreshToken ? obj.refreshToken : undefined,
      expiresAt: expiresAt && Number.isFinite(expiresAt) ? expiresAt : undefined,
      supabaseUrl: typeof obj.supabaseUrl === 'string' && obj.supabaseUrl ? obj.supabaseUrl : undefined,
      anonKey: typeof obj.anonKey === 'string' && obj.anonKey ? obj.anonKey : undefined,
    }
  } catch (err) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') return {}
    throw new CLIError(EXIT_GENERIC, 'CONFIG_READ', `读取配置文件失败 ${configPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 合并优先级:flag > 环境变量(RECHO_BASE_URL / RECHO_TOKEN)> 配置文件。 */
export function resolveConfig(input: ConfigInput, file: CLIConfigFile = {}): ResolvedCLIConfig {
  const baseUrl = (
    input.baseUrl ||
    process.env.RECHO_BASE_URL ||
    file.baseUrl ||
    ''
  ).trim().replace(/\/+$/, '')
  const token = (input.token || process.env.RECHO_TOKEN || file.accessToken || file.token || '').trim() || null

  if (!baseUrl) {
    throw new CLIError(
      EXIT_NOT_LOGGED_IN,
      'NOT_LOGGED_IN',
      '未配置站点地址，请先运行 `recho login --base-url <URL> --token <TOKEN>`，或通过环境变量 RECHO_BASE_URL 设置。',
    )
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new CLIError(EXIT_NOT_LOGGED_IN, 'BAD_BASE_URL', `站点地址必须以 http(s):// 开头: ${baseUrl}`)
  }
  return {
    baseUrl,
    token,
    configPath: input.configPath || defaultConfigPath(),
    supabaseUrl: file.supabaseUrl,
    anonKey: file.anonKey,
    refreshToken: file.refreshToken,
    expiresAt: file.expiresAt,
  }
}

export interface SaveConfigInput {
  baseUrl: string
  /** 旧直登模式:只有 access token,无刷新能力 */
  token?: string
  /** 浏览器登录模式:完整会话 */
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  supabaseUrl?: string
  anonKey?: string
}

/** 写入配置文件(目录自动创建,文件权限 0600)。 */
export async function saveConfig(configPath: string, cfg: SaveConfigInput): Promise<string> {
  const payload: Record<string, unknown> = {
    baseUrl: cfg.baseUrl,
    accessToken: cfg.accessToken ?? cfg.token,
  }
  if (cfg.refreshToken) payload.refreshToken = cfg.refreshToken
  if (typeof cfg.expiresAt === 'number') payload.expiresAt = cfg.expiresAt
  if (cfg.supabaseUrl) payload.supabaseUrl = cfg.supabaseUrl
  if (cfg.anonKey) payload.anonKey = cfg.anonKey
  await writeConfigFile(configPath, payload)
  return configPath
}

/** 仅更新令牌段(自动刷新后回写),保留 baseUrl 等原有字段。 */
export async function updateSession(configPath: string, session: CLISession): Promise<void> {
  const file = await readConfigFile(configPath)
  await writeConfigFile(configPath, {
    baseUrl: file.baseUrl,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    supabaseUrl: file.supabaseUrl,
    anonKey: file.anonKey,
  })
}

async function writeConfigFile(configPath: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  // 显式清理 undefined 字段,保证输出稳定
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) if (value !== undefined) clean[key] = value
  await writeFile(configPath, `${JSON.stringify(clean, null, 2)}\n`, { encoding: 'utf8', flag: 'w', mode: 0o600 })
  await chmod(configPath, 0o600).catch(() => undefined)
}

/** 删除配置文件,返回文件原本是否存在。 */
export async function removeConfig(configPath: string): Promise<boolean> {
  try {
    await rm(configPath, { force: true })
    return true
  } catch {
    return false
  }
}