import { CLIError, EXIT_USAGE } from '../types.js'
import { saveConfig, removeConfig, defaultConfigPath } from '../config.js'
import { printJson } from '../io.js'

export interface LoginCommandOptions {
  baseUrl?: string | undefined
  token?: string | undefined
  configPath?: string | undefined
  json: boolean
}

export interface LogoutCommandOptions {
  configPath?: string | undefined
  json: boolean
}

export async function login(opts: LoginCommandOptions): Promise<void> {
  const baseUrl = (opts.baseUrl || '').trim()
  const token = (opts.token || '').trim()
  if (!baseUrl || !token) {
    throw new CLIError(EXIT_USAGE, 'BAD_ARGS', 'login 需要 --base-url <URL> 与 --token <TOKEN> 两个参数。')
  }
  const normalized = baseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) {
    throw new CLIError(EXIT_USAGE, 'BAD_BASE_URL', `站点地址必须以 http(s):// 开头: ${baseUrl}`)
  }
  const configPath = opts.configPath || defaultConfigPath()
  await saveConfig(configPath, { baseUrl: normalized, token })
  if (opts.json) {
    printJson({ ok: true, baseUrl: normalized, configPath })
    return
  }
  console.log(`已保存配置到 ${configPath}`)
  console.log(`站点地址: ${normalized}`)
}

export async function logout(opts: LogoutCommandOptions): Promise<void> {
  const configPath = opts.configPath || defaultConfigPath()
  await removeConfig(configPath)
  if (opts.json) {
    printJson({ ok: true, configPath })
    return
  }
  console.log(`已删除配置 ${configPath}`)
}