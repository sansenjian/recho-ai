import http from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestObservabilityMiddleware } from '../backend/gateway/src/middleware/request-observability'
import goSidecarRouter from '../backend/gateway/src/routes/go-sidecar'
import {
  loadGoOwnedContract,
  materializeContractPath,
  type GoOwnedContractRoute,
} from './helpers/go-owned-contract'

vi.mock('../backend/gateway/src/services/image-attempts', () => ({
  recordImageGenerationAttempt: vi.fn(async () => undefined),
}))

type TestServer = {
  server: http.Server
  url: string
}

type CapturedRequest = {
  method: string
  path: string
  query: string
  headers: http.IncomingHttpHeaders
  body: string
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
  if (!address || typeof address === 'string') throw new Error('test server did not bind')
  return { server, url: `http://127.0.0.1:${address.port}` }
}

async function close(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections?.()
  })
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function routeHeaders(route: GoOwnedContractRoute, requestId: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: 'Bearer contract-token',
    'X-Request-ID': requestId,
  }
  for (const header of route.headers) {
    if (header === 'Content-Type') {
      headers[header] = route.requestKind === 'json' ? 'application/json' : 'application/octet-stream'
    } else if (header === 'Idempotency-Key') {
      headers[header] = `idem_${route.id}`
    } else if (header === 'X-Reference-ID') {
      headers[header] = 'contract-reference'
    } else if (header === 'X-Reference-Title') {
      headers[header] = 'Contract Reference'
    } else if (header === 'X-Reference-Filename') {
      headers[header] = 'contract.png'
    }
  }
  return headers
}

function routeBody(route: GoOwnedContractRoute): string | undefined {
  if (route.requestKind === 'json') return JSON.stringify({ contract: true })
  if (route.requestKind === 'binary') return 'contract-binary-body'
  return undefined
}

describe('go sidecar shared contract', () => {
  const servers: http.Server[] = []
  const originalBaseUrl = process.env.GO_GATEWAY_BASE_URL

  afterEach(async () => {
    restoreEnv('GO_GATEWAY_BASE_URL', originalBaseUrl)
    await Promise.all(servers.splice(0).map(close))
  })

  it('forwards every contracted method, path, query, header, and body', async () => {
    const captured: CapturedRequest[] = []
    const upstream = await listen(http.createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      captured.push({
        method: req.method || '',
        path: new URL(req.url || '/', 'http://upstream').pathname,
        query: new URL(req.url || '/', 'http://upstream').search,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Request-ID': 'req_wrong_upstream',
      })
      res.end(JSON.stringify({ contract: true, images: [] }))
    }))
    servers.push(upstream.server)
    process.env.GO_GATEWAY_BASE_URL = upstream.url

    const app = express()
    app.use(requestObservabilityMiddleware)
    app.use('/api', goSidecarRouter)
    const proxy = await listen(http.createServer(app))
    servers.push(proxy.server)

    const contract = await loadGoOwnedContract()
    for (const route of contract.routes) {
      const requestId = `req_contract_${route.id}`
      const path = materializeContractPath(route.path)
      const response = await fetch(`${proxy.url}${path}?contract=query`, {
        method: route.method,
        headers: routeHeaders(route, requestId),
        body: routeBody(route),
      })

      expect(response.status, route.id).toBe(route.successStatuses[0])
      expect(response.headers.get(contract.requestIdHeader), route.id).toBe(requestId)
      await response.arrayBuffer()

      const request = captured.at(-1)
      expect(request, route.id).toBeDefined()
      expect(request?.method, route.id).toBe(route.method)
      expect(request?.path, route.id).toBe(path)
      expect(request?.query, route.id).toBe('?contract=query')
      expect(request?.headers.authorization, route.id).toBe('Bearer contract-token')
      expect(request?.headers['x-request-id'], route.id).toBe(requestId)
      for (const header of route.headers) {
        expect(request?.headers[header.toLowerCase()], `${route.id}:${header}`).toBe(
          routeHeaders(route, requestId)[header],
        )
      }
      expect(request?.body, route.id).toBe(routeBody(route) || '')
    }

    expect(captured).toHaveLength(contract.routes.length)
  }, 20_000)
})
