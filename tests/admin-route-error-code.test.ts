import http from 'node:http'
import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import adminCreditsRouter from '../backend/gateway/src/routes/admin-credits'
import adminImagesRouter from '../backend/gateway/src/routes/admin-images'

type TestServer = {
  server: http.Server
  url: string
}

async function listen(server: http.Server): Promise<TestServer> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind to a TCP port')
  }

  return {
    server,
    url: 'http://127.0.0.1:' + address.port,
  }
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

/**
 * 两个管理路由都挂在 /api 下,与 backend/gateway/src/index.ts 的挂载方式一致。
 * 这里走真实 HTTP 而不是直接调 helper:helper 未导出,而出问题的恰恰是路由的 catch
 * 分支(曾经只转发 error、丢掉 code),只有走完整链路才能守住这个回归。
 */
function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', adminCreditsRouter)
  app.use('/api', adminImagesRouter)
  return app
}

/** 不带 Authorization 头即判定为未登录,无需 mock 任何外部依赖。 */
function requestRoute(server: TestServer, method: string, route: string, payload: Record<string, unknown> | null) {
  return fetch(server.url + route, {
    method,
    ...(payload
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {}),
  })
}

describe('admin routes forward the machine-readable error code', () => {
  const servers: http.Server[] = []

  beforeEach(() => {
    // 鉴权失败时路由会 console.warn,测试里静音以免污染输出。
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(servers.splice(0).map(close))
  })

  it('returns both error and code on the admin credits route', async () => {
    const testServer = await listen(http.createServer(createApp()))
    servers.push(testServer.server)

    const response = await requestRoute(testServer, 'GET', '/api/admin/credits/me', null)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: '请先登录。',
      code: 'auth_required',
    })
  })

  it('returns both error and code on the admin images route', async () => {
    const testServer = await listen(http.createServer(createApp()))
    servers.push(testServer.server)

    const response = await requestRoute(testServer, 'GET', '/api/admin/images?limit=24&offset=0', null)
    const body = await response.json() as { error?: string; code?: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe('请先登录。')
    expect(body.code).toBe('auth_required')
  })

  // 评论点名的是「两个管理员路由」,因此逐个路由都验一遍 code 是否还在响应体里。
  it.each([
    ["GET", "/api/admin/images?limit=24&offset=0", null],
    ["GET", "/api/admin/images/storage-overview", null],
    ["GET", "/api/admin/images/img-1/media", null],
    ["PATCH", "/api/admin/images/bulk/visibility", {"ids":["img-1"],"visibility":"private"}],
    ["POST", "/api/admin/images/bulk/archive", {"ids":["img-1"]}],
    ["POST", "/api/admin/images/bulk/delete", {"ids":["img-1"]}],
    ["PATCH", "/api/admin/images/img-1/visibility", {"visibility":"public"}],
  ] as Array<[string, string, Record<string, unknown> | null]>)('keeps code on admin images %s %s', async (method, route, payload) => {
    const testServer = await listen(http.createServer(createApp()))
    servers.push(testServer.server)

    const response = await requestRoute(testServer, method, route, payload)
    const body = await response.json() as { code?: string }

    expect(response.status).toBe(401)
    expect(body.code).toBe('auth_required')
  })

  // 评论点名的是「两个管理员路由」,因此逐个路由都验一遍 code 是否还在响应体里。
  it.each([
    ["GET", "/api/admin/credits/me", null],
    ["GET", "/api/admin/credits/users", null],
    ["GET", "/api/admin/credits/overview", null],
    ["GET", "/api/admin/credits/transactions", null],
    ["GET", "/api/admin/credits/users/user-1", null],
    ["POST", "/api/admin/credits/users/user-1/adjust", {"amount":1}],
    ["GET", "/api/admin/credits/codes", null],
    ["GET", "/api/admin/credits/codes/code-1/redemptions", null],
    ["POST", "/api/admin/credits/codes", {"count":1}],
    ["PATCH", "/api/admin/credits/codes/code-1", {"disabled":true}],
  ] as Array<[string, string, Record<string, unknown> | null]>)('keeps code on admin credits %s %s', async (method, route, payload) => {
    const testServer = await listen(http.createServer(createApp()))
    servers.push(testServer.server)

    const response = await requestRoute(testServer, method, route, payload)
    const body = await response.json() as { code?: string }

    expect(response.status).toBe(401)
    expect(body.code).toBe('auth_required')
  })

})
