import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises'
import {
  CLIError,
  EXIT_NOT_LOGGED_IN,
  EXIT_GENERIC,
  type CLIConfigFile,
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
    return {
      baseUrl: typeof obj.baseUrl === 'string' && obj.baseUrl ? obj.baseUrl : undefined,
      token: typeof obj.token === 'string' && obj.token ? obj.token : undefined,
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
  const token = (input.token || process.env.RECHO_TOKEN || file.token || '').trim() || null

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
  return { baseUrl, token, configPath: input.configPath || defaultConfigPath() }
}

/** 写入配置文件(目录自动创建,文件权限 0600)。 */
export async function saveConfig(configPath: string, cfg: { baseUrl: string; token: string }): Promise<string> {
  await mkdir(dirname(configPath), { recursive: true })
  const payload = `${JSON.stringify({ baseUrl: cfg.baseUrl, token: cfg.token }, null, 2)}\n`
  await writeFile(configPath, payload, { encoding: 'utf8', flag: 'w', mode: 0o600 })
  await chmod(configPath, 0o600).catch(() => undefined)
  return configPath
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