import http from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import {
  REQUEST_ID_HEADER,
  requestId,
  requestObservabilityMiddleware,
} from '../backend/gateway/src/middleware/request-observability'

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

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function createApp() {
  const app = express()
  app.use(requestObservabilityMiddleware)
  app.get('/request-id', (req, res) => {
    res.json({ requestId: requestId(req) })
  })
  return app
}

describe('request observability middleware', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close))
  })

  it('preserves a valid request ID in the response and route request', async () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-ID')

    const testServer = await listen(http.createServer(createApp()))
    servers.push(testServer.server)

    const response = await fetch(`${testServer.url}/request-id`, {
      headers: { [REQUEST_ID_HEADER]: 'req_test-123' },
    })

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('req_test-123')
    await expect(response.json()).resolves.toEqual({ requestId: 'req_test-123' })
  })

  it('replaces an invalid request ID with a UUID', async () => {
    const testServer = await listen(http.createServer(createApp()))
    servers.push(testServer.server)

    const response = await fetch(`${testServer.url}/request-id`, {
      headers: { [REQUEST_ID_HEADER]: 'invalid request id' },
    })
    const responseRequestId = response.headers.get(REQUEST_ID_HEADER)

    expect(responseRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    await expect(response.json()).resolves.toEqual({ requestId: responseRequestId })
  })
})
