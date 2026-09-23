import { CLIError, EXIT_USAGE } from '../types.js'
import { saveConfig, removeConfig, defaultConfigPath } from '../config.js'
import { browserLogin, getSupabaseConfig } from '../auth.js'
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
  if (!baseUrl) {
    throw new CLIError(EXIT_USAGE, 'BAD_ARGS', 'login 需要 --base-url <URL>；若使用浏览器登录请省略 --token。')
  }
  const normalized = baseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) {
    throw new CLIError(EXIT_USAGE, 'BAD_BASE_URL', `站点地址必须以 http(s):// 开头: ${baseUrl}`)
  }
  const configPath = opts.configPath || defaultConfigPath()
  const token = (opts.token || '').trim()

  if (token) {
    await saveConfig(configPath, { baseUrl: normalized, token })
    if (opts.json) {
      printJson({ ok: true, baseUrl: normalized, configPath, via: 'token' })
      return
    }
    console.log(`已保存配置到 ${configPath}`)
    console.log(`站点地址: ${normalized}`)
    return
  }

  // 浏览器登录:拉起 GitHub OAuth(PKCE)回调,换完整会话
  const { url, anonKey } = await getSupabaseConfig(normalized)
  const session = await browserLogin(url, anonKey)
  await saveConfig(configPath, {
    baseUrl: normalized,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    supabaseUrl: url,
    anonKey,
  })
  if (opts.json) {
    printJson({ ok: true, baseUrl: normalized, configPath, via: 'browser' })
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