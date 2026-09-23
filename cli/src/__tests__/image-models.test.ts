import { describe, it, expect, afterEach, vi } from 'vitest'
import { imageGen } from '../commands/image.js'
import { credits } from '../commands/credits.js'
import { models } from '../commands/models.js'
import { CLIError } from '../types.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('imageGen 命令', () => {
  it('构造请求体并输出图片 URL(普通模式)', async () => {
    const gen = { images: [{ id: 'img-1', url: 'https://cdn/x.png' }], totalCost: 2, creditBalance: { balance: 10 } }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(gen), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await imageGen({
      prompt: '一只猫',
      model: 'seedream',
      size: '1024x1024',
      resolution: '2k',
      quality: 'high',
      count: 1,
      json: false,
      baseUrl: 'https://x.com',
      token: 't',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x.com/api/image/generate')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer t', 'Idempotency-Key': expect.any(String) })
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: '一只猫',
      model: 'seedream',
      size: '1024x1024',
      resolution: '2k',
      quality: 'high',
      count: 1,
    })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('https://cdn/x.png'))
  })

  it('--json 输出结构化结果', async () => {
    const gen = { images: [{ id: 'img-1', url: 'https://cdn/x.png' }], totalCost: 1, creditBalance: { balance: 9 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(gen), { status: 200 })))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await imageGen({ prompt: '猫', json: true, baseUrl: 'https://x.com', token: 't' })

    const printed = logSpy.mock.calls.map((call) => call[0] as string).join('\n')
    const parsed = JSON.parse(printed)
    expect(parsed.images[0].url).toBe('https://cdn/x.png')
    expect(parsed.totalCost).toBe(1)
    expect(parsed.creditBalance.balance).toBe(9)
  })

  it('站点未返回图片时抛业务错误(退出码 6)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ images: [] }), { status: 200 })))
    await expect(imageGen({ prompt: '猫', json: true, baseUrl: 'https://x.com', token: 't' })).rejects.toMatchObject({
      exitCode: 6,
    })
  })

  it('缺少描述时抛参数错误', async () => {
    const fakeStdin = { isTTY: false, [Symbol.asyncIterator]: async function* () {} }
    await expect(imageGen({ prompt: '', json: true, baseUrl: 'https://x.com', token: 't', stdin: fakeStdin })).rejects.toBeInstanceOf(
      CLIError,
    )
  })
})

describe('credits 命令', () => {
  it('--json 返回余额', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ balance: 42 }), { status: 200 })))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await credits({ baseUrl: 'https://x.com', token: 't', json: true })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({ balance: 42 })
  })
})

describe('models 命令', () => {
  it('无需 token 解析模型列表', async () => {
    const app = { chatModels: [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' }], imageModels: [{ id: 'seedream', name: 'Seedream' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(app), { status: 200 })))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await models({ baseUrl: 'https://x.com', json: true })
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(parsed.chatModels[0].id).toBe('gpt-4o')
    expect(parsed.imageModels[0].id).toBe('seedream')
  })
})