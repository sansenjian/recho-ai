import { createInterface } from 'node:readline'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { CLIError, EXIT_GENERIC, type ImageResult } from './types.js'
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

/** 交互场景:逐行收集,空行或 Ctrl+D 发送。 */
export function readInteractivePrompt(hint: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const lines: string[] = []
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
    rl.on('close', () => resolve(lines.join('\n').trim()))
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
    const ext = extname(new URL(url).pathname) || '.png'
    const file = join(dir, `${img.id || `image-${saved.length}`}${ext}`)
    await writeFile(file, buf)
    saved.push(file)
  }
  return saved
}