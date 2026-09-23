import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import {
  CLIError,
  EXIT_GENERIC,
  EXIT_NOT_LOGGED_IN,
  EXIT_UNAUTHORIZED,
  EXIT_UNREACHABLE,
  EXIT_USAGE,
  type CLISession,
  type ResolvedCLIConfig,
} from './types.js'
import { apiJson, toCLIErrorFromFetch } from './client.js'
import { updateSession } from './config.js'

/** 本地回调端口:Supabase Redirect URLs 需预先注册 http://127.0.0.1:12745/callback */
export const CALLBACK_PORT = 12745
const TOKEN_EXPIRY_MARGIN_MS = 30_000
const LOGIN_TIMEOUT_MS = 120_000

// ---------- PKCE ----------

/** RFC 4648 base64url,无填充。 */
export function toBase64Url(input: Buffer | string): string {
  const raw = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** 生成 PKCE verifier + S256 challenge。测试可注入固定 seed(verifier 的原始字节)。 */
export function generatePkcePair(seed?: Buffer): { verifier: string; challenge: string } {
  const verifierBytes = seed ?? randomBytes(32)
  const verifier = toBase64Url(verifierBytes)
  const challenge = toBase64Url(createHash('sha256').update(verifier, 'utf8').digest())
  return { verifier, challenge }
}

// ---------- 浏览器 ----------

export function openBrowser(url: string): void {
  let cmd: string
  let args: string[]
  if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => console.log(`请在浏览器中打开:\n  ${url}`))
  } catch {
    console.log(`请在浏览器中打开:\n  ${url}`)
  }
}

export interface BrowserLoginOptions {
  port?: number
  timeoutMs?: number
}

/** 起本地回调端口,浏览器完成 GitHub OAuth(PKCE)后换回 session。 */
export function browserLogin(supabaseUrl: string, anonKey: string, options: BrowserLoginOptions = {}): Promise<CLISession> {
  const port = options.port ?? CALLBACK_PORT
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS
  const { verifier, challenge } = generatePkcePair()
  const redirectTo = `http://127.0.0.1:${port}/callback`
  const authorizeUrl =
    `${supabaseUrl}/auth/v1/authorize` +
    `?provider=github&redirect_to=${encodeURIComponent(redirectTo)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&scopes=read:user`

  return new Promise<CLISession>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let url: URL
      try {
        url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      } catch {
        res.writeHead(400)
        res.end('bad request')
        return
      }
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('not found')
        return
      }
      clearTimeout(timer)

      const error = url.searchParams.get('error')
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h3>登录失败</h3><p>可以关闭此页面并在终端查看原因。</p>')
        server.close()
        reject(new CLIError(EXIT_USAGE, 'LOGIN_FAILED', `登录失败: ${error}`))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400)
        res.end('missing code')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h3>登录成功</h3><p>可以关闭此页面并回到终端。</p>', () => {
        server.close()
        exchangePkce(supabaseUrl, anonKey, code, verifier).then(resolve, reject)
      })
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new CLIError(EXIT_GENERIC, 'LOGIN_TIMEOUT', '等待浏览器登录超时，请重新运行 `recho login`。'))
    }, timeoutMs)

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        err.code === 'EADDRINUSE'
          ? new CLIError(EXIT_UNREACHABLE, 'PORT_IN_USE', `本地回调端口 ${port} 已被占用，请释放后重试。`)
          : toCLIErrorFromFetch(err),
      )
    })

    server.listen(port, '127.0.0.1', () => {
      console.log(`请在弹出的浏览器中完成登录（如未自动打开请访问）：\n  ${authorizeUrl}`)
      openBrowser(authorizeUrl)
    })
  })
}

// ---------- Supabase Auth token 端点 ----------

interface SupabaseTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

function supabaseHeaders(anonKey: string): Record<string, string> {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  }
}

/** POST /auth/v1/token,统一把 token 响应归一为 CLISession。 */
async function callTokenEndpoint(
  supabaseUrl: string,
  anonKey: string,
  query: Record<string, string>,
  body: Record<string, unknown>,
  onFailure: string,
): Promise<CLISession> {
  const queryString = new URLSearchParams(query).toString()
  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/token?${queryString}`, {
      method: 'POST',
      headers: supabaseHeaders(anonKey),
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw toCLIErrorFromFetch(err)
  }
  const data = (await res.json().catch(() => ({}))) as SupabaseTokenResponse
  if (!res.ok || !data.access_token || !data.refresh_token || typeof data.expires_in !== 'number') {
    const detail = data.error_description || data.error || res.statusText || '未知错误'
    throw new CLIError(EXIT_UNAUTHORIZED, 'AUTH_FAILED', `${onFailure}: ${detail}`)
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

/** PKCE 授权回调后换取 session。 */
export function exchangePkce(supabaseUrl: string, anonKey: string, code: string, codeVerifier: string): Promise<CLISession> {
  return callTokenEndpoint(
    supabaseUrl,
    anonKey,
    { grant_type: 'pkce' },
    { auth_code: code, code_verifier: codeVerifier },
    '登录换取令牌失败',
  )
}

/** 用 refresh_token 换新 session。 */
export function refreshAccessToken(supabaseUrl: string, anonKey: string, refreshToken: string): Promise<CLISession> {
  return callTokenEndpoint(
    supabaseUrl,
    anonKey,
    { grant_type: 'refresh_token' },
    { refresh_token: refreshToken },
    '令牌已过期',
  )
}

// ---------- 取有效 access token ----------

export interface SupabasePublicConfig {
  configured: boolean
  url: string | null
  publishableKey: string | null
}

/** GET {base}/api/config/supabase(公开端点),失败视为无法登录。 */
export async function getSupabaseConfig(baseUrl: string): Promise<{ url: string; anonKey: string }> {
  const data = await apiJson<SupabasePublicConfig>({ path: '/api/config/supabase', baseUrl })
  if (!data.configured || !data.url || !data.publishableKey) {
    throw new CLIError(EXIT_NOT_LOGGED_IN, 'SUPABASE_NOT_CONFIGURED', '站点未启用 Supabase 登录，无法进行浏览器登录。')
  }
  return { url: data.url.replace(/\/+$/, ''), anonKey: data.publishableKey }
}

/**
 * 返回当前有效的 access token:
 * - 无 token → 未登录(退出码 3)
 * - 无 refreshToken/expiresAt(旧直登)或未过期 → 直接返回
 * - 已过期 → 走 Supabase refresh grant 换新并回写配置
 */
export async function getAccessToken(cfg: ResolvedCLIConfig): Promise<string> {
  // 长期 API key(如 rk-*):站点签发,不过期,不做任何刷新
  if (cfg.apiKey) return cfg.apiKey
  if (!cfg.token) {
    throw new CLIError(EXIT_NOT_LOGGED_IN, 'NOT_LOGGED_IN', '未配置访问 token，请先运行 `recho login` 或设置环境变量 RECHO_TOKEN。')
  }
  if (!cfg.refreshToken || typeof cfg.expiresAt !== 'number') {
    // 旧格式 token 直登:无刷新能力,原样使用
    return cfg.token
  }
  if (cfg.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    return cfg.token
  }
  // 需要刷新:supabase url/anon 优先用配置落盘值,缺失则回退公共配置端点
  const { url, anonKey } =
    cfg.supabaseUrl && cfg.anonKey ? { url: cfg.supabaseUrl, anonKey: cfg.anonKey } : await getSupabaseConfig(cfg.baseUrl)
  const session = await refreshAccessToken(url, anonKey, cfg.refreshToken)
  await updateSession(cfg.configPath, session)
  return session.accessToken
}