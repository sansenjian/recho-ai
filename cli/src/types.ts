/**
 * 共享类型与错误定义。
 */

/** 退出码约定:
 * 0 成功 · 1 通用/网络错误 · 2 参数错误 · 3 未登录 · 4 401/403 · 5 站点不可达 · 6 业务错误
 */
export const EXIT_OK = 0
export const EXIT_GENERIC = 1
export const EXIT_USAGE = 2
export const EXIT_NOT_LOGGED_IN = 3
export const EXIT_UNAUTHORIZED = 4
export const EXIT_UNREACHABLE = 5
export const EXIT_BUSINESS = 6

export class CLIError extends Error {
  readonly exitCode: number
  readonly code: string

  constructor(exitCode: number, code: string, message: string) {
    super(message)
    this.name = 'CLIError'
    this.exitCode = exitCode
    this.code = code
  }
}

export function toCLIError(err: unknown): CLIError {
  if (err instanceof CLIError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new CLIError(EXIT_GENERIC, 'UNEXPECTED', message)
}

/** ~/.recho/config.json 中存储的配置。兼容旧格式 {baseUrl, token}。 */
export interface CLIConfigFile {
  baseUrl?: string
  /** 旧格式的 access token(直登模式),新格式统一存 accessToken */
  token?: string
  accessToken?: string
  refreshToken?: string
  /** access token 过期时间(毫秒时间戳) */
  expiresAt?: number
  /** Supabase Auth 直连信息(登录时落盘,供自动刷新使用) */
  supabaseUrl?: string
  anonKey?: string
}

/** 一次有效会话(access + refresh)。 */
export interface CLISession {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/** 合并 flag / 环境变量 / 配置文件后的最终解析结果。 */
export interface ResolvedCLIConfig {
  baseUrl: string
  token: string | null
  configPath: string
  /** 自动刷新所需的会话信息(仅来自配置文件) */
  supabaseUrl?: string
  anonKey?: string
  refreshToken?: string
  expiresAt?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[]
}

/** 网关 SSE 下发的工具事件(ToolCallEvent 等),type 区分事件类型。 */
export interface ChatStreamEvent {
  type: string
  [key: string]: unknown
}

export interface ChatStreamResult {
  content: string
  thinking: string
  finishReason?: string
  events: ChatStreamEvent[]
}

/** 与前端 useImageGen.ts 对齐的图片生成请求体。 */
export interface ImageGenRequest {
  prompt: string
  model?: string
  size?: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  count?: number
}

export interface ImageResult {
  id: string
  url?: string
  temporaryUrl?: string
  thumbnailUrl?: string
  prompt?: string
  userPrompt?: string
}

/** 与 Go 网关 orchestrator.GenResponse 对齐的响应。 */
export interface GenResponse {
  images?: ImageResult[]
  creditCost?: number
  totalCost?: number
  creditBalance?: { balance: number }
}

export interface CreditBalanceResponse {
  balance: number
}

export interface AppConfigModel {
  id: string
  name: string
  provider?: string
}

/** GET /api/config/app 的公共返回结构。 */
export interface AppConfig {
  chatModels?: AppConfigModel[]
  imageModels?: AppConfigModel[]
}

/** 输入流抽象:兼容 process.stdin 与测试替身(可选 isTTY + 异步迭代)。 */
export interface InputStreamLike {
  isTTY?: boolean
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>
}