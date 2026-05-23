import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

class MCPManager {
  constructor() {
    this.connections = new Map() // serverName -> { client, transport, tools: [], status }
  }

  async loadConfig(configPath) {
    try {
      const raw = await readFile(configPath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return { mcpServers: {} }
    }
  }

  async connect(serverName, serverConfig) {
    if (this.connections.has(serverName)) {
      await this.disconnect(serverName)
    }

    const client = new Client(
      { name: 'recho-gateway', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )

    let transport
    switch (serverConfig.type) {
      case 'stdio': {
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args || [],
          env: { ...process.env, ...serverConfig.env },
        })
        break
      }
      case 'sse': {
        transport = new SSEClientTransport(new URL(serverConfig.url))
        break
      }
      case 'streamableHttp': {
        transport = new StreamableHTTPClientTransport(new URL(serverConfig.url))
        break
      }
      default:
        throw new Error(`Unknown MCP transport type: ${serverConfig.type}`)
    }

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()

      this.connections.set(serverName, {
        client,
        transport,
        tools: tools || [],
        status: 'connected',
      })

      console.log(`MCP [${serverName}]: connected, ${tools?.length || 0} tool(s)`)
    } catch (err) {
      console.error(`MCP [${serverName}]: connection failed — ${err.message}`)
      this.connections.set(serverName, {
        client: null,
        transport: null,
        tools: [],
        status: `error: ${err.message}`,
      })
    }
  }

  async disconnect(serverName) {
    const conn = this.connections.get(serverName)
    if (!conn) return
    try { await conn.client?.close() } catch { /* ignore */ }
    this.connections.delete(serverName)
  }

  async disconnectAll() {
    for (const name of this.connections.keys()) {
      await this.disconnect(name)
    }
  }

  getAllTools() {
    const all = []
    for (const [serverName, conn] of this.connections) {
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

  async executeTool(toolName, args) {
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue
      const tool = conn.tools.find(t => t.name === toolName)
      if (!tool) continue
      try {
        const result = await conn.client.callTool({
          name: toolName,
          arguments: args,
        })
        return result
      } catch (err) {
        throw new Error(`Tool ${toolName} failed: ${err.message}`)
      }
    }
    throw new Error(`Tool not found: ${toolName}`)
  }

  getToolNames() {
    const names = []
    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue
      names.push(...conn.tools.map(t => t.name))
    }
    return names
  }

  async initialize() {
    const configPath = resolve(__dirname, '..', 'mcp.json')
    const config = await this.loadConfig(configPath)
    const servers = config.mcpServers || {}

    // Also check env var for inline config
    const envConfig = process.env.MCP_CONFIG
    let envServers = {}
    if (envConfig) {
      try { envServers = JSON.parse(envConfig).mcpServers || {} } catch { /* ignore */ }
    }

    const allServers = { ...servers, ...envServers }

    for (const [name, serverConfig] of Object.entries(allServers)) {
      await this.connect(name, serverConfig)
    }
  }
}

export const mcpManager = new MCPManager()
