import http from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  app.post('/test', express.text({ type: '*/*' }), (_req, res) => {
    res.status(201).json({ ok: true })
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

  it('logs a safe structured completion event', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const testServer = await listen(http.createServer(createApp()))
    servers.push(testServer.server)

    try {
      const response = await fetch(`${testServer.url}/test?secret=not-logged`, {
        method: 'POST',
        headers: {
          [REQUEST_ID_HEADER]: 'req_observability_test',
          Authorization: 'Bearer authorization-secret',
          Cookie: 'session=cookie-secret',
          'X-Body-Sensitive': 'header-body-secret',
          'Content-Type': 'text/plain',
        },
        body: 'body-secret-value',
      })

      expect(response.status).toBe(201)
      expect(info).toHaveBeenCalledTimes(1)
      expect(info.mock.calls[0]).toHaveLength(1)

      const line = info.mock.calls[0][0]
      expect(typeof line).toBe('string')
      const event = JSON.parse(line as string)
      expect(event).toMatchObject({
        level: 'info',
        service: 'node-gateway',
        event: 'request.completed',
        requestId: 'req_observability_test',
        method: 'POST',
        path: '/test',
        statusCode: 201,
      })
      expect(event.timestamp).toEqual(expect.any(String))
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp)
      expect(event.durationMs).toEqual(expect.any(Number))
      expect(event.durationMs).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(event.durationMs)).toBe(true)
      expect(line).not.toContain('secret=not-logged')
      expect(line).not.toContain('authorization-secret')
      expect(line).not.toContain('cookie-secret')
      expect(line).not.toContain('header-body-secret')
      expect(line).not.toContain('body-secret-value')
    } finally {
      info.mockRestore()
    }
  })

  it('includes the request ID in standardized API error bodies', async () => {
    const { apiErrorBody } = await import('../backend/gateway/src/services/api-error')
    const app = express()
    app.use(requestObservabilityMiddleware)
    app.get('/error-body', (req, res) => {
      res.json(apiErrorBody(req, 'GO_SIDECAR_UNAVAILABLE', 'unavailable'))
    })
    const testServer = await listen(http.createServer(app))
    servers.push(testServer.server)

    const response = await fetch(`${testServer.url}/error-body`, {
      headers: { [REQUEST_ID_HEADER]: 'req_error_test' },
    })

    await expect(response.json()).resolves.toEqual({
      error: 'unavailable',
      code: 'GO_SIDECAR_UNAVAILABLE',
      requestId: 'req_error_test',
    })
  })
})
