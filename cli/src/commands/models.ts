import { apiJson } from '../client.js'
import { printJson } from '../io.js'
import type { AppConfig } from '../types.js'

export interface ModelsCommandOptions {
  baseUrl: string
  json: boolean
}

export async function models(opts: ModelsCommandOptions): Promise<void> {
  const data = await apiJson<AppConfig>({ path: '/api/config/app', baseUrl: opts.baseUrl })
  const chatModels = data.chatModels ?? []
  const imageModels = data.imageModels ?? []
  if (opts.json) {
    printJson({ chatModels, imageModels })
    return
  }
  if (chatModels.length) {
    console.log('聊天模型:')
    for (const m of chatModels) console.log(`  ${m.id}${m.provider ? `  (${m.provider})` : ''}`)
  } else {
    console.log('聊天模型: (暂无)')
  }
  if (imageModels.length) {
    console.log('图片模型:')
    for (const m of imageModels) console.log(`  ${m.id}${m.provider ? `  (${m.provider})` : ''}`)
  } else {
    console.log('图片模型: (暂无)')
  }
}