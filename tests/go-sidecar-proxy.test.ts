import http from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'

type TestServer = {
  server: http.Server
  url: string
}

async function listen(server: http.Server): Promise<TestServer> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind to a TCP port')
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  }
}

async function close(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
}

describe('go sidecar proxy', () => {
  const servers: http.Server[] = []
  const originalGoGatewayBaseUrl = process.env.GO_GATEWAY_BASE_URL

  afterEach(async () => {
    process.env.GO_GATEWAY_BASE_URL = originalGoGatewayBaseUrl
    await Promise.all(servers.splice(0).map(close))
    vi.resetModules()
  })

  it('does not abort a POST proxy request when the incoming request body finishes normally', async () => {
    const upstream = await listen(http.createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        setTimeout(() => {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: '请输入图片描述。' }))
        }, 50)
      })
    }))
    servers.push(upstream.server)

    process.env.GO_GATEWAY_BASE_URL = upstream.url
    vi.resetModules()
    const { default: goSidecarRouter } = await import('../backend/gateway/src/routes/go-sidecar')

    const app = express()
    app.use('/api', goSidecarRouter)
    const proxy = await listen(http.createServer(app))
    servers.push(proxy.server)

    const response = await fetch(`${proxy.url}/api/image/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) })
  })
})
