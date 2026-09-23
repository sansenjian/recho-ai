import { apiJson } from '../client.js'
import { printJson } from '../io.js'
import type { CreditBalanceResponse } from '../types.js'

export interface CreditsCommandOptions {
  baseUrl: string
  token: string
  json: boolean
}

export async function credits(opts: CreditsCommandOptions): Promise<void> {
  const data = await apiJson<CreditBalanceResponse>({
    path: '/api/credits',
    baseUrl: opts.baseUrl,
    token: opts.token,
  })
  if (opts.json) {
    printJson(data)
    return
  }
  console.log(`当前余额: ${data.balance}`)
}