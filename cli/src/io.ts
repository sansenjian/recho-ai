import { createInterface } from 'node:readline'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { CLIError, EXIT_GENERIC, EXIT_USAGE, type ImageResult } from './types.js'
import { toCLIErrorFromFetch } from './client.js'

export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY)
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value))
}

/** 读满一个可读流(管道场景),并 trim 首尾空白。 */
export async function readAllStream(stream: AsyncIterable<Buffer | string>): Promise<string> {
  let out = ''
  for await (const chunk of stream) {
    out += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  }
  return out.trim()
}

/** 交互场景:逐行收集,空行或 Ctrl+D 发送,Ctrl+C 取消。 */
export function readInteractivePrompt(hint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const lines: string[] = []
    let cancelled = false
    // 不监听 SIGINT 时,Ctrl+C 会直接 close() 并把已输入内容当作 prompt 发出
    // (image 命令会因此消耗积分)。这里以错误结束。
    rl.on('SIGINT', () => {
      cancelled = true
      rl.close()
    })
    rl.setPrompt(hint)
    rl.prompt()
    rl.on('line', (line) => {
      if (!line.trim()) {
        rl.close()
        return
      }
      lines.push(line)
      rl.prompt()
    })
    rl.on('close', () => {
      if (cancelled) reject(new CLIError(EXIT_USAGE, 'CANCELLED', '已取消输入。'))
      else resolve(lines.join('\n').trim())
    })
  })
}

export function bestImageUrl(img: ImageResult): string | null {
  return img.url || img.temporaryUrl || img.thumbnailUrl || null
}

/** 将生成结果下载到本地目录,返回保存的文件路径列表。 */
export async function downloadImages(images: ImageResult[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true })
  const saved: string[] = []
  for (const img of images) {
    const url = bestImageUrl(img)
    if (!url) continue
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      throw toCLIErrorFromFetch(err)
    }
    if (!res.ok) {
      throw new CLIError(EXIT_GENERIC, 'DOWNLOAD_FAILED', `下载图片失败 ${url}: ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // img.id / url 均来自服务端响应,属不可信输入:
    // - 扩展名只认图片白名单,否则回退 .png;
    // - 文件名只取 basename 并清洗字符集,禁止把 id 里的 `../` 拼进目录
    //   (否则可写到 --download 目录之外,构成路径遍历)。
    const rawExt = extname(new URL(url).pathname).toLowerCase()
    const ext = /^\.(png|jpe?g|webp|gif)$/.test(rawExt) ? rawExt : '.png'
    const safeId = basename(String(img.id || '')).replace(/[^\w.-]/g, '_').replace(/^\.+/, '')
    const file = join(dir, `${safeId || `image-${saved.length}`}${ext}`)
    await writeFile(file, buf)
    saved.push(file)
  }
  return saved
}