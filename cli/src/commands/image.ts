import { randomUUID } from 'node:crypto'
import { apiJson } from '../client.js'
import { bestImageUrl, downloadImages, isTTY, printJson, readAllStream, readInteractivePrompt } from '../io.js'
import { CLIError, EXIT_BUSINESS, EXIT_USAGE, type GenResponse, type ImageGenRequest, type ImageResult, type InputStreamLike } from '../types.js'

export interface ImageCommandOptions {
  prompt?: string | undefined
  model?: string | undefined
  size?: string | undefined
  aspectRatio?: string | undefined
  resolution?: string | undefined
  quality?: string | undefined
  count?: number | undefined
  download?: string | undefined
  json: boolean
  baseUrl: string
  token: string
  /** 为可测试性注入 stdin(默认 process.stdin)。 */
  stdin?: InputStreamLike
}

export async function imageGen(opts: ImageCommandOptions): Promise<void> {
  const stdin = opts.stdin ?? process.stdin
  const prompt = opts.prompt && opts.prompt.length > 0
    ? opts.prompt
    : stdin.isTTY
      ? await readInteractivePrompt('请输入图片描述(空行发送, Ctrl+C 取消): ')
      : await readAllStream(stdin)

  if (!prompt.trim()) {
    throw new CLIError(EXIT_USAGE, 'EMPTY_PROMPT', '缺少图片描述：请作为参数传入或通过 stdin 管道输入。')
  }

  const body: ImageGenRequest = {
    prompt: prompt.trim(),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.size ? { size: opts.size } : {}),
    ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
    ...(opts.resolution ? { resolution: opts.resolution } : {}),
    ...(opts.quality ? { quality: opts.quality } : {}),
    ...(opts.count ? { count: opts.count } : {}),
  }

  const data = await apiJson<GenResponse>({
    method: 'POST',
    path: '/api/image/generate',
    baseUrl: opts.baseUrl,
    token: opts.token,
    body,
    headers: { 'Idempotency-Key': randomUUID() },
  })

  const images = (data.images ?? []).filter((img) => bestImageUrl(img))
  if (!images.length) {
    throw new CLIError(EXIT_BUSINESS, 'NO_IMAGE', '站点未返回图片，请稍后重试。')
  }

  let savedFiles: string[] = []
  if (opts.download) {
    savedFiles = await downloadImages(images, opts.download)
  }

  if (opts.json) {
    printJson({ images, savedFiles, creditCost: data.creditCost, totalCost: data.totalCost, creditBalance: data.creditBalance })
    return
  }

  const tty = isTTY()
  images.forEach((img: ImageResult, index: number) => {
    const label = images.length > 1 ? `图片 ${index + 1}` : '图片'
    console.log(`${label}: ${bestImageUrl(img)}`)
  })
  if (savedFiles.length) console.log(`已保存到: ${savedFiles.join(', ')}`)
  const costParts: string[] = []
  if (typeof data.totalCost === 'number') costParts.push(`本次消耗 ${data.totalCost} 积分`)
  if (data.creditBalance && typeof data.creditBalance.balance === 'number') costParts.push(`剩余 ${data.creditBalance.balance} 积分`)
  if (costParts.length && tty) console.log(costParts.join(' · '))
}