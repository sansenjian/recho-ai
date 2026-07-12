import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { requestObservabilityMiddleware } from '../backend/gateway/src/middleware/request-observability'
import goSidecarRouter from '../backend/gateway/src/routes/go-sidecar'
import { loadGoOwnedContract } from './helpers/go-owned-contract'

type LiveContractStack = {
  nodeUrl: string
  close(): Promise<void>
}

const externalEnvKeys = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'IMAGE_GEN_API_KEY',
  'PROVIDER_API_KEY_MASTER_KEY',
  'API_KEY_MASTER_KEY',
  'API_KEY_ENCRYPTION_KEY',
  'TENCENT_COS_SECRET_ID',
  'TENCENT_COS_SECRET_KEY',
]

function delay(ms: number) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

async function reservePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('failed to reserve TCP port')
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Node contract server did not bind')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: http.Server) {
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
    server.closeAllConnections?.()
  })
}

function collectOutput(child: ChildProcessWithoutNullStreams) {
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  return () => output
}

async function runCommand(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = collectOutput(child)
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} failed (${exitCode})\n${output()}`)
}

async function waitForGoHealth(child: ChildProcessWithoutNullStreams, getOutput: () => string, url: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Go Gateway exited before health check\n${getOutput()}`)
    try {
      const response = await fetch(`${url}/health`)
      if (response.status === 200) return
    } catch {
      // The process may not have bound its socket yet.
    }
    await delay(100)
  }
  throw new Error(`Go Gateway health check timed out\n${getOutput()}`)
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([
    new Promise<void>(resolveExit => child.once('exit', () => resolveExit())),
    delay(5_000),
  ])
  if (child.exitCode === null) child.kill()
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function startLiveContractStack(): Promise<LiveContractStack> {
  const repoRoot = resolve(process.cwd())
  const goGatewayDirectory = join(repoRoot, 'backend', 'go-gateway')
  const workingDirectory = await mkdtemp(join(tmpdir(), 'recho-go-contract-'))
  const binaryPath = join(workingDirectory, process.platform === 'win32' ? 'go-gateway.exe' : 'go-gateway')
  const originalBaseUrl = process.env.GO_GATEWAY_BASE_URL
  let goProcess: ChildProcessWithoutNullStreams | undefined
  let nodeServer: http.Server | undefined

  try {
    await runCommand('go', ['build', '-o', binaryPath, './cmd/server/...'], goGatewayDirectory)
    const goPort = await reservePort()
    const goUrl = `http://127.0.0.1:${goPort}`
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(goPort),
      APP_ENV: 'test',
      ENABLE_DIAGNOSTICS: 'false',
      DB_CONNECT_MAX_RETRIES: '1',
      DB_CONNECT_TIMEOUT_SECONDS: '1',
      DB_CONNECT_RETRY_INTERVAL_SECONDS: '0',
    }
    for (const key of externalEnvKeys) delete childEnv[key]
    goProcess = spawn(binaryPath, [], {
      cwd: workingDirectory,
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const getGoOutput = collectOutput(goProcess)
    await waitForGoHealth(goProcess, getGoOutput, goUrl)

    process.env.GO_GATEWAY_BASE_URL = goUrl
    const app = express()
    app.use(requestObservabilityMiddleware)
    app.use('/api', goSidecarRouter)
    nodeServer = http.createServer(app)
    const nodeUrl = await listen(nodeServer)

    return {
      nodeUrl,
      async close() {
        if (nodeServer) await closeServer(nodeServer)
        if (goProcess) await stopProcess(goProcess)
        restoreEnv('GO_GATEWAY_BASE_URL', originalBaseUrl)
        await rm(workingDirectory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (nodeServer) await closeServer(nodeServer).catch(() => undefined)
    if (goProcess) await stopProcess(goProcess).catch(() => undefined)
    restoreEnv('GO_GATEWAY_BASE_URL', originalBaseUrl)
    await rm(workingDirectory, { recursive: true, force: true })
    throw error
  }
}

describe('live Node to Go contract', () => {
  let stack: Awaited<ReturnType<typeof startLiveContractStack>>

  beforeAll(async () => {
    stack = await startLiveContractStack()
  }, 120_000)

  afterAll(async () => {
    await stack?.close()
  })

  it('runs the shared credential-free scenarios through both gateways', async () => {
    const contract = await loadGoOwnedContract()

    for (const scenario of contract.liveScenarios) {
      const requestId = `req_live_${scenario.id}`
      const response = await fetch(`${stack.nodeUrl}${scenario.path}`, {
        method: scenario.method,
        headers: { 'X-Request-ID': requestId },
      })
      const body = await response.json() as Record<string, unknown>

      expect(response.status, scenario.id).toBe(scenario.expectedStatus)
      expect(response.headers.get(contract.requestIdHeader), scenario.id).toBe(requestId)
      for (const key of scenario.requiredJsonKeys) {
        expect(body, `${scenario.id}:${key}`).toHaveProperty(key)
      }
      if (scenario.expectedCode) expect(body.code, scenario.id).toBe(scenario.expectedCode)
    }
  }, 20_000)
})
