import { apiJson, streamChat } from '../client.js'
import { isTTY, printJson, readAllStream, readInteractivePrompt } from '../io.js'
import { CLIError, EXIT_USAGE, type AppConfig, type ChatStreamEvent, type ChatMessage, type InputStreamLike } from '../types.js'

export interface ChatCommandOptions {
  prompt?: string | undefined
  model?: string | undefined
  system?: string | undefined
  skill?: string | undefined
  json: boolean
  verbose: boolean
  baseUrl: string
  token: string
  /** 为可测试性注入 stdin(默认 process.stdin)。 */
  stdin?: InputStreamLike
  stdout?: { write(chunk: string): unknown }
  isTTYOverride?: boolean
}

async function defaultChatModel(baseUrl: string): Promise<string | null> {
  const data = await apiJson<AppConfig>({ path: '/api/config/app', baseUrl })
  return data.chatModels?.[0]?.id ?? null
}

/** 解析最终 prompt:参数优先,否则非 TTY 读满 stdin,TTY 走交互输入。 */
async function resolvePrompt(opts: ChatCommandOptions): Promise<string> {
  if (opts.prompt && opts.prompt.length > 0) return opts.prompt
  const stdin = opts.stdin ?? process.stdin
  const tty = opts.isTTYOverride ?? stdin.isTTY ?? false
  if (tty && !opts.json) {
    return readInteractivePrompt('输入内容(空行发送, Ctrl+C 取消): ')
  }
  return readAllStream(stdin)
}

export async function chat(opts: ChatCommandOptions): Promise<void> {
  const prompt = await resolvePrompt(opts)
  if (!prompt.trim()) {
    throw new CLIError(EXIT_USAGE, 'EMPTY_PROMPT', '缺少聊天内容：请作为参数传入或通过 stdin 管道输入。')
  }

  const model = opts.model || (await defaultChatModel(opts.baseUrl))
  if (!model) {
    throw new CLIError(EXIT_USAGE, 'NO_MODEL', '站点未返回可用模型，请通过 --model 指定。')
  }

  const messages: ChatMessage[] = []
  if (opts.system && opts.system.trim()) messages.push({ role: 'system', content: opts.system.trim() })
  messages.push({ role: 'user', content: prompt })

  const tty = opts.isTTYOverride ?? isTTY()
  const output = opts.stdout?.write.bind(opts.stdout) ?? ((chunk: string) => process.stdout.write(chunk))

  const result = await streamChat({
    baseUrl: opts.baseUrl,
    token: opts.token,
    model,
    messages,
    skill: opts.skill,
    onEvent: (event: ChatStreamEvent) => {
      if (!opts.json && tty && event.type === 'content_delta' && typeof event.text === 'string') {
        output(event.text)
      }
    },
  })

  if (opts.json) {
    printJson({ content: result.content, thinking: result.thinking, finishReason: result.finishReason, model, events: result.events })
    return
  }

  if (tty) output('\n')
  if (result.content) {
    output(result.content)
    output('\n')
  } else if (result.thinking) {
    output(`（模型仅返回了思考过程）\n${result.thinking}\n`)
  }
  if (opts.verbose && result.thinking) {
    console.error(`\n[thinking]\n${result.thinking}`)
  }
}