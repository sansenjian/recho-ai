import http from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestObservabilityMiddleware } from '../backend/gateway/src/middleware/request-observability'
import goSidecarRouter from '../backend/gateway/src/routes/go-sidecar'

const { recordImageGenerationAttempt } = vi.hoisted(() => ({
  recordImageGenerationAttempt: vi.fn(async () => true),
}))

vi.mock('../backend/gateway/src/services/image-attempts', () => ({
  recordImageGenerationAttempt,
}))

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
    server.closeAllConnections?.()
  })
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function within<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

describe('go sidecar proxy', () => {
  const servers: http.Server[] = []
  const originalGoGatewayBaseUrl = process.env.GO_GATEWAY_BASE_URL
  const originalProxyTimeoutMs = process.env.GO_GATEWAY_PROXY_TIMEOUT_MS

  async function startProxy(goGatewayBaseUrl: string) {
    process.env.GO_GATEWAY_BASE_URL = goGatewayBaseUrl

    const app = express()
    app.use(requestObservabilityMiddleware)
    app.use('/api', goSidecarRouter)
    const proxy = await listen(http.createServer(app))
    servers.push(proxy.server)
    return proxy
  }

  afterEach(async () => {
    vi.clearAllMocks()
    restoreEnv('GO_GATEWAY_BASE_URL', originalGoGatewayBaseUrl)
    restoreEnv('GO_GATEWAY_PROXY_TIMEOUT_MS', originalProxyTimeoutMs)
    await Promise.all(servers.splice(0).map(close))
  })

  it('preserves the request ID through the sidecar request and response', async () => {
    let upstreamRequestId: string | string[] | undefined
    const upstream = await listen(http.createServer((req, res) => {
      upstreamRequestId = req.headers['x-request-id']
      req.resume()
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Request-ID': String(upstreamRequestId),
        })
        res.end(JSON.stringify({ ok: true }))
      })
    }))
    servers.push(upstream.server)
    const proxy = await startProxy(upstream.url)

    const response = await fetch(`${proxy.url}/api/image/history`, {
      headers: { 'X-Request-ID': 'req_proxy_test' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('req_proxy_test')
    expect(upstreamRequestId).toBe('req_proxy_test')
  })

  it('does not let the sidecar overwrite the Node request ID response header', async () => {
    const upstream = await listen(http.createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Request-ID': 'req_wrong_upstream',
        })
        res.end(JSON.stringify({ ok: true }))
      })
    }))
    servers.push(upstream.server)
    const proxy = await startProxy(upstream.url)

    const response = await fetch(`${proxy.url}/api/image/history`, {
      headers: { 'X-Request-ID': 'req_proxy_test' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('req_proxy_test')
  })

  it('returns a correlated standard error when the sidecar is unavailable', async () => {
    const unavailable = await listen(http.createServer())
    await close(unavailable.server)
    const proxy = await startProxy(unavailable.url)

    const response = await fetch(`${proxy.url}/api/image/history`, {
      headers: { 'X-Request-ID': 'req_proxy_test' },
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Go image service is temporarily unavailable.',
      code: 'GO_SIDECAR_UNAVAILABLE',
      requestId: 'req_proxy_test',
    })
  })

  it('returns a correlated timeout error when the sidecar request is aborted', async () => {
    const upstream = await listen(http.createServer((req) => {
      req.resume()
    }))
    servers.push(upstream.server)
    process.env.GO_GATEWAY_PROXY_TIMEOUT_MS = '50'
    const proxy = await startProxy(upstream.url)

    const response = await fetch(`${proxy.url}/api/image/history`, {
      headers: { 'X-Request-ID': 'req_proxy_test' },
    })

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({
      error: 'Go image service is temporarily unavailable.',
      code: 'GO_SIDECAR_TIMEOUT',
      requestId: 'req_proxy_test',
    })
  })

  it('records an image generation timeout as a timeout attempt', async () => {
    const upstream = await listen(http.createServer((req) => {
      req.resume()
    }))
    servers.push(upstream.server)
    process.env.GO_GATEWAY_PROXY_TIMEOUT_MS = '50'
    const proxy = await startProxy(upstream.url)

    const response = await fetch(`${proxy.url}/api/image/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(504)
    await within(vi.waitFor(() => {
      expect(recordImageGenerationAttempt).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        errorType: 'timeout',
        httpStatus: 504,
      }))
    }))
  })

  it('cancels the upstream request when a real client disconnects mid-upload', async () => {
    const upstreamStarted = deferred<void>()
    const upstreamCancelled = deferred<'aborted' | 'close'>()
    let wroteCompleteResponse = false
    const upstream = await listen(http.createServer((req, res) => {
      req.once('data', () => upstreamStarted.resolve())
      req.once('aborted', () => upstreamCancelled.resolve('aborted'))
      req.once('close', () => {
        if (!req.complete) upstreamCancelled.resolve('close')
      })
      req.once('end', () => {
        wroteCompleteResponse = true
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    }))
    servers.push(upstream.server)
    const proxy = await startProxy(upstream.url)

    const clientRequest = http.request(`${proxy.url}/api/image/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '1000',
        'X-Request-ID': 'req_proxy_test',
      },
    })
    clientRequest.on('error', () => undefined)
    clientRequest.write('{"prompt":"partial')

    await within(upstreamStarted.promise)
    clientRequest.destroy()

    await expect(within(upstreamCancelled.promise)).resolves.toMatch(/^(aborted|close)$/)
    expect(wroteCompleteResponse).toBe(false)
    expect(recordImageGenerationAttempt).not.toHaveBeenCalled()
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
    const proxy = await startProxy(upstream.url)

    const response = await fetch(`${proxy.url}/api/image/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) })
  })
})
