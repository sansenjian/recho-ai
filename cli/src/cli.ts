#!/usr/bin/env node
import { Command, CommanderError } from 'commander'
import { defaultConfigPath, readConfigFile, resolveConfig } from './config.js'
import { toCLIError, CLIError, EXIT_USAGE, type ResolvedCLIConfig } from './types.js'
import { login, logout } from './commands/login.js'
import { chat } from './commands/chat.js'
import { imageGen } from './commands/image.js'
import { credits } from './commands/credits.js'
import { models } from './commands/models.js'
import { printJson } from './io.js'

interface GlobalOptions {
  config?: string
  verbose?: boolean
  baseUrl?: string
  token?: string
  json?: boolean
}

interface ChatOptions {
  model?: string
  system?: string
  skill?: string
}

interface ImageOptions {
  model?: string
  size?: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  count?: number
  download?: string
}

/** 合并全局 flag / 环境变量 / 配置文件,并校验必需项。 */
async function loadConfig(global: GlobalOptions): Promise<ResolvedCLIConfig> {
  const configPath = global.config ?? defaultConfigPath()
  const file = await readConfigFile(configPath)
  return resolveConfig({ baseUrl: global.baseUrl, token: global.token, configPath }, file)
}

/** 包装命令执行:统一 CLIError → 输出(尊重 --json)并按退出码退出。 */
async function runCommand(json: boolean | undefined, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const cliErr = toCLIError(err)
    if (json) printJson({ error: { code: cliErr.code, message: cliErr.message, exitCode: cliErr.exitCode } })
    else console.error(`错误 [${cliErr.code}]: ${cliErr.message}`)
    process.exitCode = cliErr.exitCode
  }
}

function jsonIf(global: GlobalOptions): boolean {
  return Boolean(global.json)
}

function requireToken(cfg: ResolvedCLIConfig): ResolvedCLIConfig {
  if (!cfg.token) {
    throw new CLIError(3, 'NOT_LOGGED_IN', '未配置访问 token，请先运行 `recho login` 或设置环境变量 RECHO_TOKEN。')
  }
  return cfg
}

async function main(): Promise<void> {
  const program = new Command()
  program
    .name('recho')
    .description('recho-ai 命令行客户端:通过站点 API 在终端进行聊天与图片生成')
    .version(process.env.npm_package_version ?? '0.1.0')
    .showHelpAfterError()
    .exitOverride()
    .option('-c, --config <path>', '配置文件路径(默认 ~/.recho/config.json)')
    .option('-v, --verbose', '输出详细日志(如思考过程)')
    .option('--base-url <url>', '站点地址,覆盖配置文件')
    .option('--token <token>', '访问 token,覆盖配置文件与环境变量')
    .option('--json', '以 JSON 输出,便于 AI 解析')

  program
    .command('login')
    .description('保存站点地址与访问 token 到本机配置')
    .addHelpText('after', '需要全局参数 --base-url <URL> 与 --token <TOKEN>。')
    .action(async () => {
      const global = program.opts<GlobalOptions>()
      const json = jsonIf(global)
      await runCommand(json, () => login({ baseUrl: global.baseUrl, token: global.token, configPath: global.config, json }))
    })

  program
    .command('logout')
    .description('删除本机保存的配置')
    .action(async () => {
      const global = program.opts<GlobalOptions>()
      const json = jsonIf(global)
      await runCommand(json, () => logout({ configPath: global.config, json }))
    })

  program
    .command('chat')
    .description('与站点 AI 对话(参数优先,否则从 stdin 读取多行输入)')
    .argument('[prompt]', '聊天内容')
    .option('-m, --model <id>', '模型 id(默认取站点第一个可用聊天模型)')
    .option('--system <text>', '系统提示词')
    .option('--skill <skill>', '启用的 skill 名称')
    .action(async (prompt: string | undefined, options: ChatOptions) => {
      const global = program.opts<GlobalOptions>()
      const json = jsonIf(global)
      await runCommand(json, async () => {
        const cfg = await loadConfig(global)
        requireToken(cfg)
        await chat({
          prompt,
          model: options.model,
          system: options.system,
          skill: options.skill,
          json,
          verbose: Boolean(global.verbose),
          baseUrl: cfg.baseUrl,
          token: cfg.token as string,
        })
      })
    })

  program
    .command('image')
    .description('生成图片(参数优先,否则从 stdin 读取描述)')
    .argument('[prompt]', '图片描述')
    .option('-m, --model <id>', '图片模型 id')
    .option('--size <size>', '尺寸,如 1024x1024 / 1536x1024 / auto')
    .option('--aspect-ratio <ratio>', '宽高比,如 1:1 / 16:9 / auto')
    .option('--resolution <res>', '分辨率: auto / 1k / 2k / 4k')
    .option('--quality <quality>', '质量: auto / low / medium / high')
    .option('--count <n>', '生成数量: 1 / 2 / 4 / 8', (v) => parseInt(v, 10))
    .option('--download <dir>', '将结果图片下载到指定目录')
    .action(async (prompt: string | undefined, options: ImageOptions) => {
      const global = program.opts<GlobalOptions>()
      const json = jsonIf(global)
      await runCommand(json, async () => {
        const cfg = await loadConfig(global)
        requireToken(cfg)
        await imageGen({
          prompt,
          model: options.model,
          size: options.size,
          aspectRatio: options.aspectRatio,
          resolution: options.resolution,
          quality: options.quality,
          count: options.count,
          download: options.download,
          json,
          baseUrl: cfg.baseUrl,
          token: cfg.token as string,
        })
      })
    })

  program
    .command('credits')
    .description('查询当前账号积分余额')
    .action(async () => {
      const global = program.opts<GlobalOptions>()
      const json = jsonIf(global)
      await runCommand(json, async () => {
        const cfg = await loadConfig(global)
        requireToken(cfg)
        await credits({ baseUrl: cfg.baseUrl, token: cfg.token as string, json })
      })
    })

  program
    .command('models')
    .description('列出站点可用的聊天与图片模型(无需登录)')
    .action(async () => {
      const global = program.opts<GlobalOptions>()
      const json = jsonIf(global)
      await runCommand(json, async () => {
        const cfg = await loadConfig(global)
        await models({ baseUrl: cfg.baseUrl, json })
      })
    })

  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version(exitCode 0)  正常退出;其余 commander 错误映射为参数错误(2)
      process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE)
    }
    throw err
  }
}

main().catch((err) => {
  const cliErr = toCLIError(err)
  console.error(`错误 [${cliErr.code}]: ${cliErr.message}`)
  process.exitCode = EXIT_USAGE
})