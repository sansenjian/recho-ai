import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import OpenAI from 'openai'
import type { MCPServerConfig, MCPConnection, MCPTool, MCPToolCallResult } from './types.js'
import { safeErrorDetail } from '../services/safe-error.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface MCPConfigFile {
  mcpServers?: Record<string, MCPServerConfig>
}

class MCPManager {
  connections: Map<string, MCPConnection> = new Map()
  private serverConfigs: Map<string, MCPServerConfig> = new Map()
  private retryCounts: Map<string, number> = new Map()
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private readonly maxRetries = 3
  private readonly retryDelays = [5_000, 10_000, 20_000]

  private async loadConfig(configPath: string): Promise<MCPConfigFile> {
    try {
      const raw = await readFile(configPath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return { mcpServers: {} }
    }
  }

  async connect(serverName: string, serverConfig: MCPServerConfig): Promise<void> {
    this.serverConfigs.set(serverName, serverConfig)
    this.clearRetryTimer(serverName)
    if (this.connections.has(serverName)) {
      await this.disconnect(serverName)
    }

    const client = new Client(
      { name: 'recho-gateway', version: '1.0.0' },
      { capabilities: { tools: {} } } as any
    )

    let transport
    switch (serverConfig.type) {
      case 'stdio': {
        transport = new StdioClientTransport({
          command: serverConfig.command!,
          args: serverConfig.args || [],
          env: serverConfig.env || {},
        })
        break
      }
      case 'sse': {
        transport = new SSEClientTransport(new URL(serverConfig.url!))
        break
      }
      case 'streamableHttp': {
        transport = new StreamableHTTPClientTransport(new URL(serverConfig.url!))
        break
      }
      default:
        throw new Error(`Unknown MCP transport type: ${(serverConfig as any).type}`)
    }

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()

      this.connections.set(serverName, {
        client,
        transport,
        tools: (tools || []) as MCPTool[],
        status: 'connected',
      })

      console.log(`MCP [${serverName}]: connected, ${tools?.length || 0} tool(s)`)
      this.retryCounts.delete(serverName)
    } catch (err: any) {
      console.error(`MCP [${serverName}]: connection failed — ${safeErrorDetail(err)}`)
      this.connections.set(serverName, {
        client: null as any,
        transport: null as any,
        tools: [],
        status: 'error',
      })
      this.scheduleReconnect(serverName)
    }
  }

  private clearRetryTimer(serverName: string): void {
    const timer = this.retryTimers.get(serverName)
    if (timer) {
      clearTimeout(timer)
      this.retryTimers.delete(serverName)
    }
  }

  private scheduleReconnect(serverName: string): void {
    this.clearRetryTimer(serverName)
    const count = this.retryCounts.get(serverName) ?? 0
    if (count >= this.maxRetries) {
      console.error(`MCP [${serverName}]: max retries (${this.maxRetries}) reached, giving up`)
      this.retryCounts.delete(serverName)
      return
    }
    const delay = this.retryDelays[count] ?? this.retryDelays[this.retryDelays.length - 1]
    this.retryCounts.set(serverName, count + 1)
    console.log(`MCP [${serverName}]: scheduling reconnect attempt ${count + 1}/${this.maxRetries} in ${delay}ms`)
    const timer = setTimeout(() => {
      this.retryTimers.delete(serverName)
      this.reconnect(serverName).catch(err => {
        console.error(`MCP [${serverName}]: reconnect error:`, safeErrorDetail(err))
      })
    }, delay)
    this.retryTimers.set(serverName, timer)
  }

  async reconnect(serverName: string): Promise<void> {
    const config = this.serverConfigs.get(serverName)
    if (!config) {
      console.warn(`MCP [${serverName}]: no stored config, cannot reconnect`)
      return
    }
    await this.connect(serverName, config)
  }

  async disconnect(serverName: string): Promise<void> {
    this.clearRetryTimer(serverName)
    const conn = this.connections.get(serverName)
    if (!conn) return
    try { await conn.client?.close() } catch { /* ignore */ }
    this.connections.delete(serverName)
  }

  async disconnectAll(): Promise<void> {
    for (const name of this.connections.keys()) {
      await this.disconnect(name)
    }
  }

  getAllTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const all: OpenAI.Chat.Completions.ChatCompletionTool[] = []
    for (const [, conn] of this.connections) {
      if (conn.status !== 'connected') continue
      for (const tool of conn.tools) {
        all.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          },
        })
      }
    }
    return all
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue
      const tool = conn.tools.find(t => t.name === toolName)
      if (!tool) continue
      try {
        const result = await conn.client.callTool({
          name: toolName,
          arguments: args,
        })
        return result as MCPToolCallResult
      } catch (err: any) {
        throw new Error(`Tool ${toolName} failed: ${safeErrorDetail(err)}`)
      }
    }
    throw new Error(`Tool not found: ${toolName}`)
  }

  getToolNames(): string[] {
    const names: string[] = []
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue
      names.push(...conn.tools.map(t => t.name))
    }
    return names
  }

  async initialize(): Promise<void> {
    // Look for mcp.json relative to the gateway src directory
    const configPath = resolve(__dirname, '..', '..', 'mcp.json')
    const config = await this.loadConfig(configPath)
    const servers = config.mcpServers || {}

    const envConfig = process.env.MCP_CONFIG
    let envServers: Record<string, MCPServerConfig> = {}
    if (envConfig) {
      try { envServers = JSON.parse(envConfig).mcpServers || {} } catch { /* ignore */ }
    }

    const allServers = { ...servers, ...envServers }

    for (const [name, serverConfig] of Object.entries(allServers)) {
      await this.connect(name, serverConfig)
    }

    // Health check: ping each connected server
    for (const [name, conn] of this.connections) {
      if (conn.status !== 'connected') continue
      try {
        await conn.client.ping()
        console.log(`MCP [${name}]: ping ok`)
      } catch (err: any) {
        console.warn(`MCP [${name}]: ping failed — ${safeErrorDetail(err)}`)
      }
    }
  }
}

export const mcpManager = new MCPManager()
