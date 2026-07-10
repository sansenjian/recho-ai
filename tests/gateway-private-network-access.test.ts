import http from 'node:http'
import cors from 'cors'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { privateNetworkAccessMiddleware } from '../backend/gateway/src/middleware/private-network-access'

const ALLOWED_ORIGIN = 'https://recho.sansenjian.asia'

async function listen(app: express.Express) {
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
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

describe('private network access middleware', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close))
  })

  async function preflight(privateNetwork: boolean) {
    const app = express()
    app.use(privateNetworkAccessMiddleware)
    app.use(cors({ origin: ALLOWED_ORIGIN }))
    const testServer = await listen(app)
    servers.push(testServer.server)

    return await fetch(`${testServer.url}/api/image/generate`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
        ...(privateNetwork ? { 'Access-Control-Request-Private-Network': 'true' } : {}),
      },
    })
  }

  it('allows an approved origin to complete a private-network preflight', async () => {
    const response = await preflight(true)

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN)
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
    expect(response.headers.get('vary')).toContain('Access-Control-Request-Private-Network')
  })

  it('does not add the private-network header to a normal preflight', async () => {
    const response = await preflight(false)

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-private-network')).toBeNull()
  })
})
